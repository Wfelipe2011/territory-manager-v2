export const config = {
    // URL base da API REST (https para produção)
    API_URL: __ENV.API_URL || 'https://api.territory-manager.com.br',
    // URL base do WebSocket (wss para produção)
    WS_URL: __ENV.WS_URL || 'wss://api.territory-manager.com.br',
    // UUID da assinatura — único parâmetro obrigatório
    SIGNATURE_KEY: __ENV.SIGNATURE_KEY || '',
    // Nome do usuário virtual (aparece nos logs do servidor via evento join)
    USERNAME: __ENV.USERNAME || 'k6-load-tester',
};

// Gera headers HTTP para uma requisição autenticada
export function makeHeaders(token) {
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
    };
}
