# Desempenho do catálogo de campo

O endpoint de quadra carrega ruas e casas dentro de uma transação RepeatableRead.
Os vínculos não rejeitados já carregados delimitam a consulta de casas por IDs,
congregação, território e quadra. Casas legadas com vínculo nulo continuam visíveis.
O filtro relacional anterior gerava uma subconsulta sobre todas as casas do catálogo.

Os índices existentes de casa `(territory_id, block_id, address_id)` e participação
`(house_id, round_number)` atendem a consulta. O diagnóstico reproduzível na base
sintética é `load-tests/explain.cjs`; planos sanitizados em
`load-tests/results/explain-synthetic.json`. Não foi necessário criar índice.

Carga reutilizável e critérios: `load-tests/README.md`. Resultados do perfil v2 não
são comparáveis diretamente aos antigos: 10% marcam a cada 30s, todos acompanham,
sem sonda de escrita, tráfego Next ou rajadas. Cada ensaio tem 120s de carga.
