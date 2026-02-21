import http from 'k6/http';
import { check } from 'k6';
import { config, makeHeaders } from './config.js';

// Obtém token JWT a partir da chave de assinatura UUID (rota pública)
export function getSignature(signatureKey) {
    const res = http.get(
        `${config.API_URL}/v1/signature/${signatureKey}`,
        { tags: { name: 'getSignature' } }
    );
    check(res, { 'getSignature status is 200': (r) => r.status === 200 });
    return res.json();
}

// Lista blocos do território com o status de cada quadra
export function getTerritoryBlocks(territoryId, round, token) {
    const res = http.get(
        `${config.API_URL}/v1/territories/${territoryId}?round=${round}`,
        { headers: makeHeaders(token), tags: { name: 'getTerritoryBlocks' } }
    );
    check(res, { 'getTerritoryBlocks status is 200': (r) => r.status === 200 });
    return res.json();
}

// Lista endereços (ruas) de uma quadra  ← maior fluxo
export function getAddresses(territoryId, blockId, round, token) {
    const res = http.get(
        `${config.API_URL}/v1/territories/${territoryId}/blocks/${blockId}?round=${round}`,
        { headers: makeHeaders(token), tags: { name: 'getAddresses' } }
    );
    check(res, { 'getAddresses status is 200': (r) => r.status === 200 });
    return res.json();
}

// Lista casas de um endereço  ← maior fluxo
export function getHouses(territoryId, blockId, addressId, round, token) {
    const res = http.get(
        `${config.API_URL}/v1/territories/${territoryId}/blocks/${blockId}/address/${addressId}?round=${round}`,
        { headers: makeHeaders(token), tags: { name: 'getHouses' } }
    );
    check(res, { 'getHouses status is 200': (r) => r.status === 200 });
    return res.json();
}

// Marca ou desmarca uma casa  ← maior fluxo (dispara update_house no WS)
export function toggleHouse(territoryId, blockId, addressId, houseId, status, round, token) {
    const payload = JSON.stringify({ status: status, round: round });
    const res = http.patch(
        `${config.API_URL}/v1/territories/${territoryId}/blocks/${blockId}/address/${addressId}/houses/${houseId}`,
        payload,
        { headers: makeHeaders(token), tags: { name: 'toggleHouse' } }
    );
    check(res, {
        'toggleHouse status is 200 or 204': (r) => r.status === 200 || r.status === 204,
    });
    return res;
}
