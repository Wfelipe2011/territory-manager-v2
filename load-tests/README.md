# Testes de Carga com k6

Scripts de teste de carga para o Territory Manager, focados no fluxo principal: navegação de endereços/ruas (REST) e marcação de casas em tempo real (WebSocket).

## Estrutura

- `config.js`: Centraliza variáveis de ambiente e exposes `makeHeaders(token)`.
- `api.js`: Encapsula todas as chamadas REST (assinatura, blocos, endereços, casas, toggle).
- `main.js`: Cenário principal do VU com `setup()` dinâmico e fluxo completo REST + WebSocket.

## Como Executar

O único parâmetro obrigatório é a `SIGNATURE_KEY` (UUID da assinatura do publicador). O script busca token, território, bloco, endereço e casa automaticamente.

```bash
k6 run \
  -e SIGNATURE_KEY=c6b85860-76b2-4b0e-a8a4-66afc68d926c \
  load-tests/main.js
```

Contra ambiente local:
```bash
k6 run \
  -e API_URL=http://localhost:3000 \
  -e WS_URL=ws://localhost:3000 \
  -e SIGNATURE_KEY=<uuid> \
  load-tests/main.js
```

## Variáveis de Ambiente

| Variável | Descrição | Padrão |
|---|---|---|
| `SIGNATURE_KEY` | UUID da assinatura (obrigatório) | `''` |
| `API_URL` | URL base da API REST | `https://api.territory-manager.com.br` |
| `WS_URL` | URL base do WebSocket | `wss://api.territory-manager.com.br` |
| `USERNAME` | Nome do VU nos logs do servidor | `k6-load-tester` |

## Fluxo por Iteração do VU

1. `setup()` (executa uma única vez): busca token via assinatura → extrai `territoryId`/`round` do JWT → busca bloco → busca endereço → busca casa.
2. Cada VU repete:
   - `GET /v1/territories/:id/blocks/:id?round=N` — lista de ruas
   - `GET /v1/territories/:id/blocks/:id/address/:id?round=N` — lista de casas
   - Conexão WebSocket + `join` na sala `${territorio}-${bloco}-${endereco}-${round}`
   - `PATCH` marcar casa (`status: true`) → servidor emite `update_house` no WS
   - `PATCH` desmarcar casa (`status: false`) para não poluir dados reais
   - Fechar WebSocket

## Escalando a Carga

Para aumentar VUs sem alterar o código, sobrescreva pelo CLI:

```bash
# 50 usuários simultâneos por 2 minutos
k6 run --vus 50 --duration 2m \
  -e SIGNATURE_KEY=<uuid> \
  load-tests/main.js
```

Ou edite os `stages` em `main.js` para ramp-up gradual:

```js
stages: [
  { duration: '1m',  target: 10  }, // sobe para 10 usuários em 1 min
  { duration: '5m',  target: 50  }, // sobe para 50 usuários em 5 min
  { duration: '2m',  target: 100 }, // pico: 100 usuários
  { duration: '2m',  target: 0   }, // ramp-down
]
```
