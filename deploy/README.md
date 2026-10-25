# Recursos e sincronização de campo — produção Swarm

O **`docker-compose.yml` na raiz da API é o manifesto completo de produção**:
API NestJS, worker Bun/pg, proxy interno nginx e PgBouncer. Não há overlay separado
para o Bun. Esse é o arquivo lido pela stack Git `api-production` no Portainer.
O PostgreSQL continua na sua stack própria; NPM é configurado separadamente.

Usar o manifesto como stack Swarm. A ordem entre serviços não depende de
`depends_on`: migrations precisam estar aplicadas antes do deploy; healthchecks,
reinício e rollback são controlados pelo Swarm. O template nginx é distribuído
por Docker config, sem bind mount dependente do filesystem do nó de execução.

## Orçamento

| Serviço | CPU máxima | Memória |
|---|---:|---|
| PostgreSQL externo | 0,8 | Preservar configuração existente |
| Worker Bun/pg | 0,7 | 2 GiB |
| API NestJS | 0,4 | 2 GiB existentes |
| Proxy interno | 0,1 | 128 MiB |

Total **2 CPUs para esses quatro serviços**, não para toda a VPS. Reservar capacidade
adicional para Admin, PgBouncer, NPM, sistema e outros serviços. CPU é teto, não
reserva garantida. A variante sintética usou banco com 2 GiB: memória e carga de
produção precisam de avaliação antes do corte. Não reduzir memória por este ajuste.
O pool de consultas do worker permanece dois + uma conexão dedicada de LISTEN,
checagem de segurança 1s e espera HTTP 25s. Nenhuma candidata experimental é usada.

O limite de 0,8 CPU do banco é uma proposta separada para sua stack, não é aplicado
pelo manifesto da API. Na inspeção de produção, o banco tinha 1 CPU/1 GiB; manter
esse limite provisoriamente resulta em 2,2 CPUs de tetos somados. Não confundir isso
com uma reserva de 2,2 cores ou alterar o banco silenciosamente para fechar a soma.

## Pré-requisitos de uma futura publicação

1. Backup validado e janela de manutenção. API e Admin unificado devem ser versões
   compatíveis; **não fazer apenas a troca de CPU em uma imagem antiga da API**.
2. Gerar API (`Dockerfile.production`) e worker (`Dockerfile.field`) da MESMA revisão
   aprovada; fixar `API_IMAGE` e `FIELD_WORKER_IMAGE` em digests imutáveis. O manifesto
   não cria/publica imagens. Não usar a imagem de experimento. Os workflows abaixo
   publicam o par, mas não executam deploy.
3. Prover as variáveis do projeto (PostgreSQL, SMTP etc.), mais:
   - `API_IMAGE` e `FIELD_WORKER_IMAGE`: par validado, não tags móveis.
   - `JWT_SECRET` e `API_KEY_SECRET`: mesmos valores da API e do worker.
   - `DIRECT_URL`: URL PostgreSQL direta, utilizada pelas migrations Prisma.
   - `FIELD_DATABASE_URL`: URL PostgreSQL direta para o worker (schema `public`).
     Não usar PgBouncer em modo `transaction`, nem simplesmente copiar a URL da
     API que aponta para esse pool. Codificar caracteres especiais das credenciais
      na URL; guardar segredos fora do Git.
   - `PGBOUNCER_IMAGE`: opcional; preservar o digest da instância atual para não
     atualizar PgBouncer incidentalmente. `FIELD_PROXY_IMAGE` também aceita digest.
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
  Imagens são publicadas sequencialmente, não atomicamente. Não automatizar corte
  usando apenas tags móveis ou presumir par completo se o workflow falhar.
- Somente após os dois pushes bem-sucedidos, o job escreve os digests no resumo
  da execução e no artefato `territory-image-pair-<ambiente>-<SHA>-<tentativa>`.
  O artefato contém `image-pair.json` (revisão, execução e referências completas)
  e `image-pair.env` (`API_IMAGE=...@sha256:...`, `FIELD_WORKER_IMAGE=...@sha256:...`).
  Esse env não contém credenciais e não substitui o arquivo seguro de publicação.
   Usar os digests juntos no `docker-compose.yml`, não imagens de execuções diferentes.
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
Validar migrations antes de iniciar a API, depois worker e proxy. A API saudável
não substitui a verificação de migrations: o worker recusa iniciar sem read model.
Não executar migration, recriação ou publish somente para validar YAML.

O proxy usa `app-prod:3000` e expõe `8080` apenas na rede `npm_public`. No corte
coordenado de API/Admin, configurar o NPM para `territory-api-proxy:8080` (HTTP),
preservando TLS/domínio público. **Essa mudança não é automática nem foi executada.**
Verificar acesso à rede, URL pública do Admin, links novos e compatibilidade legada.
O template `deploy/nginx-api.conf.template` precisa acompanhar o manifesto no
checkout Git do Portainer. O Swarm o entrega aos nós como Docker config, não
como bind mount nem como configuração embutida no NPM. Versionar o nome do config
no manifesto quando modificar seu conteúdo: configs Swarm são imutáveis.
Não publicar a porta do worker ou do proxy no host.

Conferir depois do corte: healthchecks, listener conectado, pool dois, intervalo
1000ms; `X-Territory-Upstream: field-worker` em sync e `api` nas demais rotas,
login/assinaturas, uma marcação em tenant QA e sua propagação. Nenhuma carga em dados
reais. A inspeção dos serviços Swarm deve confirmar `Resources.Limits.NanoCPUs`
700000000/400000000/100000000. O banco só terá 800000000 após ajuste separado.

## Rollback de tráfego

Preservar upstream anterior do NPM, digests anteriores e configuração do banco.
Com a API atual compatível, `FIELD_SYNC_UPSTREAM=app-prod:3000` permite recriar
somente o proxy para encaminhar também sync ao NestJS, sem excluir migrations ou
dados; reiniciar o proxy também após substituir endpoints para renovar DNS.
O worker pode continuar saudável. Rollback para imagens anteriores à unificação
exige rollback coordenado API/Admin e do upstream público, não apenas esse override.
Não usar `down -v`, apagar volumes ou reverter migrations aditivas como parte deste
ajuste. Restaurar quotas anteriores na stack do banco se necessário.

## Ambiente local

No workspace, `docker-compose.yml` aplica o mesmo orçamento de CPU aos quatro
serviços. API/Admin continuam em desenvolvimento; não é uma reprodução exata do
build de produção. Memória, banco/volume, pool e URLs locais são preservados.
