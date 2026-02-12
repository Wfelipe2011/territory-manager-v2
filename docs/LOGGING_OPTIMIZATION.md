# Otimização de Logs e Debug

Este documento lista pontos críticos onde os logs devem ser ajustados para evitar "sujeira" (spam) no CloudWatch e melhorar a observabilidade, focando principalmente em CRON jobs e operações de alta frequência.

## 1. Princípios Gerais (Boas Práticas)

*   **Evite Logs em Loops**: Nunca coloque `logger.log()` dentro de `for` ou `.map` a menos que seja um erro.
*   **Debug vs Info**:
    *   **DEBUG**: Informações detalhadas para desenvolvimento local (payloads, passos de algoritmo). *Não enviado para CloudWatch em produção.*
    *   **LOG (INFO)**: Eventos de negócio concluídos (ex: "Assinatura Removida", "Job Finalizado", "Erro em Transação").
*   **Dados Sensíveis**: Nunca faça `JSON.stringify` de objetos de usuário ou requisição inteiros em logs de nível INFO.

## 2. Pontos de Melhoria Identificados

### 🔴 Crítico: Gateways e Sockets de Alta Frequência
**Arquivo**: `src/modules/gateway/event.gateway.ts`

*   **Problema**: O método `handleCron` roda a cada 30 segundos e loga "Nenhum socket desconectado" no nível `LOG`. Isso gera ~2.800 logs inúteis por dia.
*   **Problema**: O método `emitRoom` loga *cada* emissão de evento. Em produção, isso pode dobrar o volume de logs.
*   **Solução Sugerida**:
    ```typescript
    // Mudar de .log para .debug
    this.logger.debug('Emitindo evento ...');
    
    // Na Cron:
    if (disconnectedSockets.length === 0) {
      this.logger.debug('Nenhum socket desconectado'); // Mudado de .log
      return;
    }
    ```

### 🟡 Médio: CRON de Limpeza
**Arquivo**: `src/modules/signature/signature.service.ts`

*   **Problema**: A CRON `deleteSignatureExpired` roda a cada 10 minutos e sempre loga o início e fim, mesmo que não faça nada.
*   **Solução Sugerida**:
    ```typescript
    @Cron(CronExpression.EVERY_10_MINUTES)
    async deleteSignatureExpired() {
      // Remover ou mudar start para debug
      this.logger.debug('Verificando assinaturas expiradas...'); 
      
      const { count } = await this.prisma.signature.deleteMany(...);
      
      // Só logar INFO se algo realmente aconteceu
      if (count > 0) {
        this.logger.log(`Limpeza CRON: ${count} assinaturas expiradas removidas.`);
      }
    }
    ```

### 🟡 Médio: Logs Verbosos e PII em Controllers
**Arquivo**: `src/modules/house/house.controller.ts`

*   **Problema**: Linha ~42 faz `JSON.stringify(req.user)` no nível `LOG`.
    *   Pode expor dados sensíveis.
    *   Gera logs multilinhas desnecessários.
*   **Solução Sugerida**:
    ```typescript
    // Antes
    this.logger.log(`Usuário ${JSON.stringify(req.user)} ...`);
    
    // Depois (Logar apenas ID ou E-mail)
    this.logger.log(`Usuário ID:${req.user.id} buscou endereços (Território: ${territoryId})`);
    ```

### ⚪ Otimização Futura: Workers
**Arquivo**: `src/modules/house/house-worker.service.ts`

*   **Observação**: O código existente (comentado) possui logs dentro de loops `for`. Quando reativado, deve-se mover os logs de sucesso para *fora* do loop (ex: "Processou X itens") e manter dentro do loop apenas `error` ou `debug`.

## 3. Resumo das Ações Recomendadas

| Arquivo | Método/Local | Ação Recomendada | Impacto |
| :--- | :--- | :--- | :--- |
| `event.gateway.ts` | `handleCron` | Mudar "Nenhum socket..." para `debug` | **Alto** (Redução de ruído) |
| `event.gateway.ts` | `emitRoom` | Mudar log de emissão para `debug` | **Alto** (Redução de volume) |
| `signature.service.ts`| `deleteSignatureExpired` | Logar apenas se `count > 0` ou usar `debug` | Médio |
| `house.controller.ts` | `getAddressPer...` | Remover `JSON.stringify` do user | Segurança/Limpeza |

---

## 4. Mudanças Implementadas

**Data de Implementação:** 11 de Fevereiro de 2026

### Resumo Executivo
- **Arquivos Modificados:** 7 arquivos (6 src + 1 test)
- **Redução Estimada:** ~3.500+ logs desnecessários por dia
- **Melhorias de Segurança:** 8 locais com exposição de PII corrigidos

### Detalhamento por Categoria

#### 🔴 **Crítico - Gateways de Alta Frequência**

**event.gateway.ts**
- ✅ `handleCron` (Linha 127): `logger.log` → `logger.debug` para "Nenhum socket desconectado"
- ✅ `emitRoom` (Linha 105): `logger.log` → `logger.debug` para emissões de eventos
- **Impacto:** CRON roda a cada 30s = ~2.880 logs/dia removidos do nível INFO

**upload.gateway.ts**
- ✅ `handleConnection` (Linhas 24, 27): Logs de conexão para `debug`
- ✅ `handleDisconnect` (Linha 35): Log de desconexão para `debug`
- ✅ `sendProgress` (Linhas 39, 44, 46): Todos os logs de progresso para `debug`
- **Impacto:** Redução de centenas de logs por dia em operações WebSocket

#### 🟡 **Médio - CRONs de Limpeza**

**signature.service.ts**
- ✅ `deleteSignatureExpired` (Linhas 211, 217): Log de início para `debug`, log final condicional (`if count > 0`)
- **Impacto:** ~144 logs/dia reduzidos, mantendo visibilidade apenas quando há ação

#### 🔐 **Segurança - Remoção de PII**

**house.controller.ts** (3 métodos corrigidos)
- ✅ Linha 42: `JSON.stringify(req.user)` → `req.user.id` em `getAddressPerTerritoryByIdAndBlockById`
- ✅ Linha 72: Mesmo ajuste em `getHousesPerTerritoryByIdAndBlockByIdAndAddressById`
- ✅ Linha 104: Mesmo ajuste em `updateHouse`

**territory.controller.ts** (4 métodos corrigidos)
- ✅ Linha 75: `JSON.stringify(req.user)` → `req.user.id` em `createTerritory`
- ✅ Linha 111: Mesmo ajuste em `getTerritoryTypes`
- ✅ Linha 151: Mesmo ajuste em `getTerritoryEditById`
- ✅ Linha 192: Mesmo ajuste em `getTerritoryById`

**territory/v2/territory.controller.ts** (1 método corrigido)
- ✅ Linha 63: `JSON.stringify(user)` → `user.id` em `getTerritoryEditById`

**Padrão Implementado:**
```typescript
// Antes (8 locais)
this.logger.log(`Usuário ${JSON.stringify(req.user, null, 2)} está fazendo X`);

// Depois
this.logger.log(`Usuário ID:${req.user.id} está fazendo X`);
```

#### 🧪 **Atualização de Testes**

**test/socket.e2e-spec.ts**
- ✅ Linha 235: Spy alterado de `'log'` → `'debug'` para validar novo nível
- ✅ Teste continua validando a mensagem "Nenhum socket desconectado" no nível correto

### Verificações Realizadas

✅ **Auditoria de PII:** Confirmado que não há mais `JSON.stringify(req.user)` ou `JSON.stringify(user)` no código  
✅ **Auditoria de CRONs:** Confirmado que nenhum CRON usa `logger.log` para mensagens de rotina  
✅ **Erros de Compilação:** 0 erros nos arquivos modificados  
✅ **Testes Atualizados:** socket.e2e-spec.ts ajustado para validar `.debug()`

### Comandos de Verificação para CI/CD

```bash
# Verificar ausência de PII em logs
grep -rn "JSON.stringify(req.user" src/ || echo "✅ Sem JSON.stringify(req.user)"
grep -rn "JSON.stringify(user" src/ --include="*.controller.ts" || echo "✅ Sem JSON.stringify(user)"

# Verificar CRONs usam debug
! grep -A2 "@Cron" src/**/*.ts | grep "logger.log" && echo "✅ CRONs usam debug"

# Rodar testes E2E (requer Docker)
npm run test:integration
```

### Próximos Passos Recomendados

1. **Integração CloudWatch** (Próxima iteração)
   - Instalar `winston-cloudwatch`
   - Configurar filtro de nível por ambiente (`DEBUG` apenas em dev)
   - Integrar Winston logger já configurado em `src/infra/logger.ts`

2. **Monitoramento de Volume** (Pós-deploy)
   - Medir redução real de logs no CloudWatch
   - Calcular economia de custos
   - Ajustar níveis se necessário

3. **Otimizações Adicionais** (Se necessário)
   - Revisar `adress-block.service.ts` com múltiplos `JSON.stringify` em loops
   - Considerar logs estruturados (JSON format) para melhor parseabilidade
   - Avaliar se `auth.guard.ts` (log em cada request) precisa ser condicional

---
*Gerado por GitHub Copilot*
