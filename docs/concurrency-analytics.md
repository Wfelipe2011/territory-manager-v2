# Analytics de simultaneidade HTTP

O painel `/v1/dashboard/health` usa presença HTTP compartilhada, não sockets ou
número de polls abertos. Conta `client_id` distinto: abas do mesmo navegador
contam uma vez. Não são pessoas únicas. Exige `last_seen_at > now()-60s`, ausência
de saída e assinatura ainda válida. A mesma regra inclui presenças escritas pelo
Bun e pelo NestJS. Não adiciona chamadas ao celular nem altera o worker.

## Persistência

Aplicar a migration aditiva `20261026000000_field_concurrency_analytics` **antes**
de iniciar a nova API. Não há alteração de dados de casas, rodadas ou sessões.

O `ConcurrencyService` da API coleta ao iniciar e a cada 30s, mesmo sem visitas ao
dashboard. Lock transacional PostgreSQL e PK por janela/escopo garantem que
réplicas não dupliquem amostras/agregados; funcionam com PgBouncer transacional.
Cada coleta grava total global e cada congregação (inclusive zeros).
Global deduplica dispositivos entre congregações, logo não é necessariamente a
soma delas. Não se guardam IDs de dispositivos, tokens ou conteúdo de requests.

- `field_concurrency_sample`: contagem por janela de 30s e escopo (0 = global).
- `field_concurrency_hour`: número de amostras, soma das contagens, máximo e
  primeiro horário desse máximo por hora/escopo. Atualizado atomicamente somente
  para amostras efetivamente inseridas. Mantido sem expiração automática.
- Detalhes anteriores a 90 dias (limite arredondado à hora) são removidos depois
  da gravação dos agregados, na mesma transação. Agregados sobrevivem à retenção.

Médias são ponderadas pelo número de amostras, não médias de médias. Picos são
máximos **registrados**, não exatos: picos menores que 30s podem escapar. Não há
backfill especulativo; interrupção da coleta não é transformada em zero. A tela
mostra última coleta, aviso de atraso e número de amostras por intervalo.

## Consulta

`/v1/sessions?period=1d|3d|7d|30d&groupBy=10min|30min|1h|1d`, ou `from`/`to`
ISO, intervalo semiaberto e até 366 dias. Mantém o controle de acesso preexistente
desse endpoint; o painel é de superadmin. A política de exposição pública das
rotas legadas `/v1/sessions` e `/v1/health-check` merece revisão separada.

O painel apresenta online agora, pico e horário, médias, gráfico e tabela geral
ou por congregação, com atualização a cada 30s e opção de pausa. Horários são
exibidos em São Paulo; janelas são alinhadas em UTC.

Consultas horárias/diárias usam agregados. Períodos maiores que 7 dias têm no
mínimo agrupamento horário; maiores que 31 dias, diário. Consultas anteriores à
retenção têm no mínimo resolução horária. Os limites são arredondados para fora
à hora inteira quando se usam agregados; a resposta retorna limites efetivos,
`resolutionSeconds` e `groupSeconds`. Não se inventa precisão de 30s em dados
horários. Histórico começa quando a nova coleta é ativada.

## Operação e rollback

Validar `bash dev/test-api.sh concurrency.e2e-spec.ts app.e2e-spec.ts` e build.
Revisar crescimento de armazenamento conforme número de congregações. Em falha,
o coletor registra erro e tenta novamente no próximo ciclo; o painel avisa atraso.
Rollback da API pode manter as tabelas aditivas e os registros coletados. Não
remover migration/tabelas para voltar à versão anterior. Publicação/deploy e
aplicação da migration em produção continuam exigindo autorização específica.
