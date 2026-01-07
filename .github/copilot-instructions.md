# Guia de Testes de Integração - Territory Manager
Este guia descreve como configurar e executar os testes de integração (E2E) de forma confiável neste projeto.

## **DIRETRIZES DE DESIGN DE TESTE (RÍGIDAS)**

### **Nomenclatura e Organização**
* Testes **em pt-BR**.
* Máx. **4–5 testes por arquivo**.
* Divida por responsabilidade quando crescer.

## 🧪 Lógica de Testes (E2E)

### 1. Configuração do Ambiente
Os testes de integração não utilizam o banco de desenvolvimento. Eles rodam em um container isolado:
- **Banco:** PostgreSQL na porta `5433`.
- **Arquivo de Configuração:** `.env.test`.
- **Docker Compose:** `docker-compose.test.yml`.

### 2. Rodar a Suíte Completa e Aguardar
O projeto possui um script que automatiza o ciclo de vida dos testes (sobe o banco, migra, testa e derruba):
```bash
npm run test:integration
```
*Dica: Este script garante que o banco esteja pronto antes de iniciar.*

### 3. Rodar Testes Individuais
Se precisar debugar um arquivo específico, você deve garantir que a infraestrutura de teste esteja ativa e migrada antes de chamar o Jest. Siga este fluxo obrigatoriamente:

1.  **Subir o Banco:** `npm run test:db:up`
2.  **Aguardar Disponibilidade:** `npx wait-on tcp:127.0.0.1:5433` e dê um `sleep 2`.
3.  **Rodar Migrations:** `npm run test:db:migrate`
4.  **Executar o Teste:**
    ```bash
    npm run test:e2e -- test/nome-do-teste.e2e-spec.ts
    ```
5.  **Limpar Ambiente:** `npm run test:db:down`

*O parâmetro `--runInBand` é essencial para evitar concorrência no banco de dados de teste.*

### 4. Resolução de Problemas Comuns
- **Erro de Conexão (5433):** Se o banco não subir a tempo, o Jest falhará. O script `test-integration.sh` resolve isso com `wait-on`.
- **Extensão pg_trgm:** Se encontrar erros de similaridade, certifique-se de que o container de teste foi iniciado corretamente, pois a extensão é criada via código no `beforeAll` dos testes.
- **Exclusão de Blocos:** A lógica de exclusão no `BlockService` é agressiva para limpar todas as dependências e evitar erros de Foreign Key durante os testes.
