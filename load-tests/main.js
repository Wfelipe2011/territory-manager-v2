import sse from 'k6/x/sse';
import { check, sleep } from 'k6';
import encoding from 'k6/encoding';
import { config } from './config.js';
import { getSignature, getTerritoryBlocks, getAddresses, getHouses, toggleHouse } from './api.js';

// Carga parametrizável via env: LISTENER_VUS, TOGGLER_VUS, SSE_DURATION_SECS.
// Smoke: 1/1/50 · Leve: 2/3/60 · Média: 5/10/180
// ENABLE_SSE=0 remove o cenário de listener (ambientes sem SSE, ex.: PRD).
const LISTENER_VUS = Number(__ENV.LISTENER_VUS || 1);
const TOGGLER_VUS = Number(__ENV.TOGGLER_VUS || 1);
const SSE_DURATION_SECS = Number(__ENV.SSE_DURATION_SECS || 50);
const TOGGLER_DURATION_SECS = Math.max(SSE_DURATION_SECS - 5, 10);
const ENABLE_SSE = __ENV.ENABLE_SSE !== '0';

const scenarios = {
    houseToggler: {
        executor: 'constant-vus',
        vus: TOGGLER_VUS,
        duration: `${TOGGLER_DURATION_SECS}s`,
        exec: 'houseToggler',
        startTime: '5s', // espera o listener conectar antes de começar os toggles
    },
};

if (ENABLE_SSE) {
    scenarios.sseListener = {
        executor: 'constant-vus',
        vus: LISTENER_VUS,
        duration: `${SSE_DURATION_SECS}s`,
        exec: 'sseListener',
        startTime: '0s',
    };
}

export const options = {
    scenarios,
    thresholds: {
        // Global
        http_req_duration: ['p(95)<2000'],
        http_req_failed: ['rate<0.01'],
        // Por endpoint (permite identificar o gargalo isoladamente)
        'http_req_duration{name:getSignature}': ['p(95)<500'],   // rota pública, deve ser rápida
        'http_req_duration{name:getTerritoryBlocks}': ['p(95)<1000'],
        'http_req_duration{name:getAddresses}': ['p(95)<1000'],  // maior fluxo
        'http_req_duration{name:getHouses}': ['p(95)<1500'],     // maior fluxo com mais dados
        'http_req_duration{name:toggleHouse}': ['p(95)<1500'],   // PATCH + broadcast SSE
    },
};

if (ENABLE_SSE) {
    // A conexão SSE do listener é longa por design (50s) — o threshold mede
    // liveness (sobreviveu até o fim), não latência.
    options.thresholds['http_req_duration{name:sseStreet}'] = ['p(95)<60000'];
}

// Retorna um item aleatório do array
function randomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// setup() é executado UMA vez — carrega token, bloco/rua/casas fixos para o smoke test.
// Listener e toggler usam a MESMA rua, senão o fan-out de street_changed não alcança o listener.
export function setup() {
    const { SIGNATURE_KEY } = config;
    if (!SIGNATURE_KEY) throw new Error('SIGNATURE_KEY é obrigatório. Passe -e SIGNATURE_KEY=<uuid>');

    // 1. Obter token via assinatura (rota pública)
    const sigData = getSignature(SIGNATURE_KEY);
    const token = sigData.token;
    const round = sigData.roundInfo.roundNumber;

    // 2. Extrair territoryId (e blockId, se chave de bloco) do payload JWT via k6/encoding (sem atob)
    const jwtPayload = JSON.parse(encoding.b64decode(token.split('.')[1], 'rawstd', 's'));
    const territoryId = jwtPayload.territoryId;

    // 3. Chave de bloco já carrega blockId no JWT (rota de público). Chave de território
    // (dirigente) não pode acessar GET /v1/territories/:tid — só ADMIN/DIRIGENTE — então
    // só buscamos a lista de blocos quando o JWT não traz blockId.
    let blockId = jwtPayload.blockId;
    if (!blockId) {
        const territoryData = getTerritoryBlocks(territoryId, round, token);
        const blocks = territoryData.blocks;
        if (!blocks || !blocks.length) throw new Error('Nenhum bloco disponível no território');
        blockId = blocks[0].id;
    }

    // 4. Escolher a rua com mais casas visitáveis (≥ MIN_HOUSES, fallback: a maior encontrada)
    const MIN_HOUSES = 5;
    const blockData = getAddresses(territoryId, blockId, round, token);
    const addresses = blockData.addresses || [];
    if (!addresses.length) throw new Error('Nenhuma rua disponível no bloco');

    let bestAddressId = addresses[0].id;
    let bestVisitable = -1;
    let visitableHouses = [];
    for (const address of addresses) {
        const houseData = getHouses(territoryId, blockId, address.id, round, token);
        const visitable = (houseData.houses || []).filter((h) => !h.dontVisit);
        if (visitable.length > bestVisitable) {
            bestVisitable = visitable.length;
            bestAddressId = address.id;
            visitableHouses = visitable;
        }
        if (visitable.length >= MIN_HOUSES) break;
    }
    const addressId = bestAddressId;
    if (!visitableHouses.length) throw new Error('Nenhuma casa visitável na rua');

    console.log(
        `[setup] território=${territoryId} | rodada=${round} | bloco=${blockId} | rua=${addressId} | casas visitáveis=${visitableHouses.length}`,
    );

    return { token, territoryId, round, blockId, addressId, visitableHouses };
}

// Listener: assina a rua fixa e apenas ESCUTA (handlers leves, sem trabalho bloqueante).
// O loop de eventos do xk6-sse é serial — trabalho pesado num handler descarta os próximos eventos.
export function sseListener(data) {
    const { token, territoryId, round, blockId, addressId } = data;
    const { API_URL, SIGNATURE_KEY } = config;

    let streetChangedCount = 0;

    const sseUrl = `${API_URL}/v1/realtime/street/${territoryId}/${blockId}/${addressId}?s=${SIGNATURE_KEY}&round=${round}`;

    const res = sse.open(sseUrl, { tags: { name: 'sseStreet' } }, function (client) {
        client.on('open', () => {
            console.log('[SSE] conexão estabelecida');
        });

        client.on('event', (event) => {
            try {
                if (event.name === 'connected') {
                    const payload = JSON.parse(event.data);
                    check(payload, { 'SSE connected com streetKey': (p) => typeof p.streetKey === 'string' });
                } else if (event.name === 'street_changed') {
                    streetChangedCount++;
                    const payload = JSON.parse(event.data);
                    check(payload, {
                        'SSE street_changed recebido': (p) => p.streetKey !== undefined && p.reason === 'HOUSE_UPDATED',
                    });
                } else if (event.name === 'presence_changed') {
                    const payload = JSON.parse(event.data);
                    check(payload, { 'SSE presence_changed recebido': (p) => p.userCount > 0 });
                } else if (event.name === 'ping') {
                    // heartbeat — ignorar
                } else if (event.name === 'error') {
                    const payload = JSON.parse(event.data);
                    console.error('[SSE] erro do servidor: ', payload.reason);
                    client.close();
                } else if (event.name !== '') {
                    console.log(`[SSE] evento não tratado: ${event.name}`);
                }
                // event.name === '' = linha em branco que abre o stream — ignorar
            } catch (e) {
                // Evento malformado no teardown não pode virar script exception
                console.error(`[SSE] evento inválido (${event.name}): `, e.message);
            }
        });

        client.on('error', (e) => {
            try {
                console.error('[SSE] erro de conexão: ', e.error());
                client.close();
            } catch (err) {
                // conexão já encerrada no teardown — ignorar
            }
        });
    });

    check(res, {
        'SSE conexão estabelecida (200)': (r) => r && r.status === 200,
        'SSE street_changed recebidos > 0': () => streetChangedCount > 0,
    });
}

// Toggler: marca/desmarca casas da MESMA rua que o listener assina,
// simulando agentes visitando casas e gerando o fan-out de street_changed.
export function houseToggler(data) {
    const { token, territoryId, round, blockId, addressId, visitableHouses } = data;

    const clickCount = Math.min(5, visitableHouses.length);
    const selectedHouses = visitableHouses.slice(0, clickCount);

    console.log(`[toggler] bloco=${blockId} | rua=${addressId} | cliques=${clickCount}`);

    // Marcar cada casa com delay aleatório (simula visita real de 1-3s por casa)
    for (let i = 0; i < selectedHouses.length; i++) {
        toggleHouse(territoryId, blockId, addressId, selectedHouses[i].id, true, round, token);
        sleep(randomBetween(1, 3));
    }
    // Desmarcar todas para não poluir dados reais
    for (let j = 0; j < selectedHouses.length; j++) {
        toggleHouse(territoryId, blockId, addressId, selectedHouses[j].id, false, round, token);
    }
    sleep(2);
}

// Retorna inteiro aleatório entre min e max (inclusive)
function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
