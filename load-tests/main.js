import ws from 'k6/ws';
import { check, sleep } from 'k6';
import encoding from 'k6/encoding';
import { config, makeHeaders } from './config.js';
import { getSignature, getTerritoryBlocks, getAddresses, getHouses, toggleHouse } from './api.js';

export const options = {
    stages: [
        { duration: '10s', target: 1 }, // Ramp-up: 1 usuário
        { duration: '30s', target: 1 }, // Sustentação
        { duration: '10s', target: 0 }, // Ramp-down
    ],
    thresholds: {
        // Global
        http_req_duration: ['p(95)<2000'],                          // geral: 2s com 100 VUs
        http_req_failed: ['rate<0.01'],                             // menos de 1% de erros
        // Por endpoint (permite identificar o gargalo isoladamente)
        'http_req_duration{name:getSignature}': ['p(95)<500'],  // rota pública, deve ser rápida
        'http_req_duration{name:getTerritoryBlocks}': ['p(95)<1000'],
        'http_req_duration{name:getAddresses}': ['p(95)<1000'], // maior fluxo
        'http_req_duration{name:getHouses}': ['p(95)<1500'], // maior fluxo com mais dados
        'http_req_duration{name:toggleHouse}': ['p(95)<1500'], // PATCH + WS broadcast
    },
};

// Retorna um item aleatório do array
function randomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// Retorna inteiro aleatório entre min e max (inclusive)
function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Embaralha array (Fisher-Yates) sem modificar o original
function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
}

// setup() é executado UMA vez — carrega token e lista de blocos para os VUs.
// Cada VU navega de forma independente e aleatória dentro dessa lista.
export function setup() {
    const { SIGNATURE_KEY } = config;
    if (!SIGNATURE_KEY) throw new Error('SIGNATURE_KEY é obrigatório. Passe -e SIGNATURE_KEY=<uuid>');

    // 1. Obter token via assinatura (rota pública)
    const sigData = getSignature(SIGNATURE_KEY);
    const token = sigData.token;
    const round = sigData.roundInfo.roundNumber;

    // 2. Extrair territoryId do payload JWT via k6/encoding (sem atob)
    const jwtPayload = JSON.parse(encoding.b64decode(token.split('.')[1], 'rawstd', 's'));
    const territoryId = jwtPayload.territoryId;

    // 3. Buscar todos os blocos do território
    const territoryData = getTerritoryBlocks(territoryId, round, token);
    const blocks = territoryData.blocks;

    console.log(`[setup] território=${territoryId} | rodada=${round} | blocos disponíveis=${blocks.length}`);

    return { token, territoryId, round, blocks };
}

// Cada iteração do VU sorteia aleatoriamente: bloco → rua → 1 a 10 casas
export default function (data) {
    const { token, territoryId, round, blocks } = data;
    const { WS_URL, USERNAME } = config;

    // 1. Sortear bloco aleatório
    const block = randomItem(blocks);
    const blockId = block.id;

    // 2. Buscar ruas do bloco e sortear uma aleatoriamente
    const blockData = getAddresses(territoryId, blockId, round, token);
    const addresses = blockData.addresses || [];
    if (!addresses.length) return;
    const address = randomItem(addresses);
    const addressId = address.id;
    sleep(randomBetween(1, 2));

    // 3. Buscar casas, filtrar visitáveis e selecionar 1 a 10 aleatoriamente
    const houseData = getHouses(territoryId, blockId, addressId, round, token);
    const visitableHouses = (houseData.houses || []).filter((h) => !h.dontVisit);
    if (!visitableHouses.length) return;
    const clickCount = Math.min(randomBetween(1, 10), visitableHouses.length);
    const selectedHouses = shuffle(visitableHouses).slice(0, clickCount);
    sleep(randomBetween(1, 2));

    console.log(`[VU] bloco=${blockId} | rua=${addressId} | cliques=${clickCount}`);

    // 4. WebSocket — conectar na sala da rua sorteada
    const roomName = `${territoryId}-${blockId}-${addressId}-${round}`;
    const wsUrl = `${WS_URL}/socket.io/?EIO=4&transport=websocket`;

    const res = ws.connect(wsUrl, { headers: makeHeaders(token) }, function (socket) {
        socket.on('open', () => {
            socket.send(`40${JSON.stringify({ token: token })}`);
        });

        socket.on('message', (msg) => {
            if (msg.startsWith('40')) {
                // Entrar na sala
                socket.send(`42${JSON.stringify(['join', { roomName: roomName, username: USERNAME }])}`);

                // Um único setTimeout com loop síncrono — mais estável que setTimeout recursivo
                socket.setTimeout(() => {
                    // Marcar cada casa com delay aleatório (simula visita real de 1-3s por casa)
                    for (var i = 0; i < selectedHouses.length; i++) {
                        toggleHouse(territoryId, blockId, addressId, selectedHouses[i].id, true, round, token);
                        sleep(randomBetween(1, 3));
                    }
                    // Desmarcar todas para não poluir dados reais
                    for (var j = 0; j < selectedHouses.length; j++) {
                        toggleHouse(territoryId, blockId, addressId, selectedHouses[j].id, false, round, token);
                    }
                    socket.close();
                }, 1000);

            } else if (msg.startsWith('42')) {
                var eventData = JSON.parse(msg.substring(2));
                var eventName = eventData[0];
                var payload = eventData[1];

                if (eventName === roomName) {
                    if (payload.type === 'user_joined') {
                        check(payload, { 'WS user_joined recebido': (p) => p.data.userCount > 0 });
                    } else if (payload.type === 'update_house') {
                        check(payload, { 'WS update_house recebido': (p) => p.data.houseId !== undefined });
                    }
                }
            } else if (msg === '2') {
                // Engine.IO ping — responder com pong
                socket.send('3');
            }
        });

        socket.on('error', (e) => {
            if (e.error() !== 'websocket: close sent') {
                console.error('[WS] Erro: ', e.error());
            }
        });
    });

    check(res, { 'WS conexão estabelecida (101)': (r) => r && r.status === 101 });
    sleep(1);
}
