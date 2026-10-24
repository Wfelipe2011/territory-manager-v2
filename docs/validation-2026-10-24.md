# Validação local — 24/10/2026

## Evidência funcional antes da referência de carga

- `bash dev/test-api.sh --silent`: 34 suítes, 184 testes aprovados, três SMTP ignorados conforme instruções do projeto.
- `docker compose exec -T api npm test -- --runInBand --silent`: seis suítes, 27 testes unitários aprovados.
- `bash dev/test-field.sh`: nove testes Playwright aprovados usando Chrome headless, congregação QA isolada e Admin em 4800.
- `npm run typecheck` no Admin: aprovado.
- Build Docker de produção API/Admin: aprovado. Next mantém três avisos antigos de dependências de hooks em telas administrativas fora deste ajuste.
- Primeiro ensaio de navegador foi interrompido por `ERR_NETWORK_CHANGED` durante criação da rede Docker; repetição completa com rede estável passou.

Os testes exercitam cadastro provisório de quadra/rua/casa, marcação antes da
aprovação, preservação de ID/data/marcação, rodada automática padrão concorrente,
rejeição com impacto reconfirmado após clique, exclusão de dependentes, correção
rejeitada preservando o aprovado, isolamento entre congregações e permissões.
Navegação valida login, compartilhamento, UUID legado, revogação, ausência de
WebSocket, uma consulta por tela, offline/reconexão, expansão/rolagem preservadas,
cadeado/toast sem confirmação de escrita e larguras mobile sem overflow.

Navegação automatizada: Playwright existente no projeto, Chrome headless; não foi
usado MCP de navegador. Evidências visuais locais em `../dev/screenshots/`.

## Carga

A preparação inicial foi interrompida por falta de espaço em disco. Nenhuma
medição de referência foi atribuída a essa preparação. Foi liberado cache de
build do Docker e removida apenas a base sintética parcial do compose de carga.
Resultados e comparação serão registrados em `load-tests/results/` e no relatório
de carga depois das execuções, com os commits e imagens efetivamente utilizados.
