# Recursos e sincronização de campo — produção Swarm

O **`docker-compose.yml` na raiz da API é o manifesto completo de produção**:
API NestJS, worker Bun/pg e PgBouncer. Não há nginx adicional nem overlay separado
para o Bun. Esse é o arquivo lido pela stack Git `api-production` no Portainer.
O PostgreSQL continua na sua stack própria; o NPM existente faz a divisão de rotas.

Usar o manifesto como stack Swarm. A ordem entre serviços não depende de
`depends_on`: migrations precisam estar aplicadas antes do deploy; healthchecks,
reinício e rollback são controlados pelo Swarm. As regras do NPM estão versionadas
em `deploy/npm-field-locations.conf`, mas não são aplicadas por esse Compose.

## Orçamento

| Serviço | CPU máxima | Memória |
|---|---:|---|
| PostgreSQL externo | 0,8 | Preservar configuração existente |
| Worker Bun/pg | 0,7 | 2 GiB |
| API NestJS | 0,4 | 2 GiB existentes |
| NPM existente | Fora desta stack | Preservar configuração existente |

Total proposto **1,9 CPU para banco, API e worker**, não para toda a VPS. Reservar capacidade
adicional para Admin, PgBouncer, NPM, sistema e outros serviços. CPU é teto, não
reserva garantida. A variante sintética usou banco com 2 GiB: memória e carga de
produção precisam de avaliação antes do corte. Não reduzir memória por este ajuste.
O pool de consultas do worker permanece dois + uma conexão dedicada de LISTEN,
checagem de segurança 1s e espera HTTP 25s. Nenhuma candidata experimental é usada.

O limite de 0,8 CPU do banco é uma proposta separada para sua stack, não é aplicado
pelo manifesto da API. Na inspeção de produção, o banco tinha 1 CPU/1 GiB; manter
esse limite provisoriamente resulta em 2,1 CPUs de tetos somados. Não confundir isso
com uma reserva de 2,1 cores ou alterar o banco silenciosamente para fechar a soma.

## Pré-requisitos de uma futura publicação

1. Backup validado e janela de manutenção. API e Admin unificado devem ser versões
   compatíveis; **não fazer apenas a troca de CPU em uma imagem antiga da API**.
2. Aguardar a publicação bem-sucedida da API (`Dockerfile.production`) e do worker
   (`Dockerfile.field`) da MESMA revisão aprovada. Os repositórios e tags `master`
   estão definidos no próprio `docker-compose.yml`: não cadastrar variáveis de
   imagem no Portainer. O manifesto não publica imagens e não usa experimentos.
   Registrar os digests anteriores para rollback e conferir a revisão das duas
   imagens após o redeploy. Os workflows publicam o par, mas não executam deploy.
3. Prover as variáveis do projeto (PostgreSQL, SMTP etc.), mais:
   - `JWT_SECRET` e `API_KEY_SECRET`: mesmos valores da API e do worker.
   - `DIRECT_URL`: URL PostgreSQL direta, utilizada pelas migrations Prisma.
   - `FIELD_DATABASE_URL`: URL PostgreSQL direta para o worker (schema `public`).
     Não usar PgBouncer em modo `transaction`, nem simplesmente copiar a URL da
     API que aponta para esse pool. Codificar caracteres especiais das credenciais
      na URL; guardar segredos fora do Git.
   O PgBouncer permanece fixado no Compose no digest da instância inspecionada,
   para não atualizar esse componente incidentalmente.
4. Na stack EXISTENTE que administra o PostgreSQL, aplicar limite 0,8 CPU, preservando
   volume, imagem e demais configurações. `postgres.resources.example.yml` é só um
   fragmento: adaptar ao nome real do serviço, **não criar/substituir banco**. Esta
   configuração não consegue limitar um PostgreSQL hospedado fora do Docker.
5. Manter Admin/PgBouncer/NPM dentro da capacidade adicional da máquina. O limite
   de conexões da API/PgBouncer não foi aumentado ou reduzido neste ajuste.

## Publicação pelo GitHub Actions

- Push em `master`: `.github/workflows/ci.yml` publica API em
  `wfelipe2011/territorio-digital-prod` e worker em
  `wfelipe2011/territorio-digital-field-worker-prod`.
- Push em `acp`: `.github/workflows/ci.acp.yml` publica API em
  `wfelipe2011/territorio-digital-acceptance` e worker em
  `wfelipe2011/territorio-digital-field-worker-acceptance`.
- Ambos usam o mesmo checkout, `Dockerfile.production` e `Dockerfile.field`;
  preservam tags de branch (`master`/`acp`) e acrescentam `sha-<SHA completo>`.
  Imagens são publicadas sequencialmente, não atomicamente. Aguardar o workflow
  completo antes de usar Redeploy from git; não redeployar após somente o push
  Git ou presumir par completo se a publicação de uma das imagens falhar.
- Somente após os dois pushes bem-sucedidos, o job escreve os digests no resumo
  da execução e no artefato `territory-image-pair-<ambiente>-<SHA>-<tentativa>`.
  O artefato contém `image-pair.json` (revisão, execução e referências completas)
  e `image-pair.env` (`API_IMAGE=...@sha256:...`, `FIELD_WORKER_IMAGE=...@sha256:...`).
  Esse artefato não contém credenciais e serve para conferência/rollback: não é
  obrigatório importar suas variáveis na stack. O Compose usa as tags `master`.
  Para rollback, restaurar os dois digests correspondentes, não misturar execuções.
- Reutiliza `DOCKER_USERNAME` e `DOCKER_PASSWORD`. A conta/token precisa de escrita
  também nos dois novos repositórios do worker; verificar/criar esses repositórios
  e sua visibilidade no Docker Hub antes da primeira execução.
- Os workflows não acessam VPS, Portainer, NPM ou banco; não aplicam migrations.
  Publicar imagens não certifica os testes de integração nem autoriza deploy.
  A verificação unitária do gerador de artefatos roda antes do login no registry.

## Validação e ordem de operação (não executadas em produção)

Na raiz da API, usando variáveis seguras do ambiente de publicação:

```bash
# Valida sem subir nada; -q evita imprimir segredos resolvidos.
docker compose -f docker-compose.yml config -q
# Também validar a compatibilidade Swarm, descartando a saída com segredos:
docker stack config -c docker-compose.yml > /dev/null
```

Para o corte futuro: baixar o par de imagens aprovado; pausar tráfego e executar
`prisma migrate deploy` com a imagem da API e `DIRECT_URL` direta, incluindo
`20261025190000_field_read_model`. O startup de produção atual NÃO migra sozinho.
Validar migrations antes de iniciar a API e o worker. A API saudável
não substitui a verificação de migrations: o worker recusa iniciar sem read model.
Não executar migration, recriação ou publish somente para validar YAML.

No Proxy Host existente de `api.territory-manager.com.br`, manter Details com
Scheme `http`, Forward Hostname `app-prod`, Forward Port `3000`; preservar SSL,
domínio e controle de acesso. Não criar outro Proxy Host com o mesmo domínio.
Depois de confirmar API e Bun saudáveis, acrescentar o conteúdo completo de
`deploy/npm-field-locations.conf` em Advanced > Custom Nginx Configuration,
preservando regras preexistentes sem duplicar locations. O trecho encaminha
somente sync, session e healthz para `api-production_field-worker:3402`;
marcações, autenticação e demais rotas continuam no destino padrão NestJS.
O nome é qualificado pela stack para evitar colisões de aliases na rede compartilhada.
NPM e worker precisam estar em `npm_public`. Não publicar porta do worker no host.
Validar `nginx -t`, status Online, HTTPS e repasse do URI/query antes de encerrar
o corte. Não habilitar cache, buffering ou retries nesse long polling. Não
reintroduzir Socket.IO nem alterar as URLs públicas do frontend.

Conferir depois do corte: healthchecks, listener conectado, pool dois, intervalo
1000ms; `X-Territory-Upstream: field-worker` em sync; demais rotas devem manter o
comportamento da API (o NPM não adiciona automaticamente o header `api`),
login/assinaturas, uma marcação em tenant QA e sua propagação. Nenhuma carga em dados
reais. A inspeção dos serviços Swarm deve confirmar `Resources.Limits.NanoCPUs`
700000000/400000000. O banco só terá 800000000 após ajuste separado.

## Rollback de tráfego

Preservar upstream anterior do NPM, digests anteriores e configuração do banco.
Com a API atual compatível, remover apenas o bloco acrescentado em Advanced
devolve também sync ao destino padrão `app-prod:3000`, sem excluir migrations ou
dados. Validar e salvar pelo NPM, preservando as demais regras existentes.
O worker pode continuar saudável. Rollback para imagens anteriores à unificação
exige rollback coordenado API/Admin e do upstream público, não apenas essa regra.
Não usar `down -v`, apagar volumes ou reverter migrations aditivas como parte deste
ajuste. Restaurar quotas anteriores na stack do banco se necessário.

## Ambiente local

No workspace, `docker-compose.yml` aplica o mesmo orçamento de CPU aos quatro
serviços. API/Admin continuam em desenvolvimento; não é uma reprodução exata do
build de produção. Memória, banco/volume, pool e URLs locais são preservados.
