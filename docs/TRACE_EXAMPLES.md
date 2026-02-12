# Exemplos de Logs com TraceId e SessionId

## Cenário: Usuário Faz Login e Consulta Territórios

### Logs Console

```bash
# ============================================
# SESSÃO 1: Wilson Felipe (User ID: 1)
# IP: 192.168.1.100
# SessionId: sess-{hash(192.168.1.100:1)}
# ============================================

# Requisição 1: Login
[2026-02-12T01:54:18.453Z] [1770861258453-frxhb9utx][sess-a1b2c3d4e5f6] debug [AuthGuard] Rota pública - /v1/login - POST +0ms
[2026-02-12T01:54:18.454Z] [1770861258453-frxhb9utx][sess-a1b2c3d4e5f6] info [AuthService] login wfelipe2011@gmail.com POST /v1/login +1ms
[2026-02-12T01:54:18.714Z] [1770861258453-frxhb9utx][sess-a1b2c3d4e5f6] info [AuthService] Gerando token wfelipe2011@gmail.com POST /v1/login +260ms

# Requisição 2: Buscar Territórios (mesmo usuário, mesmo IP = SessionId idêntico!)
[2026-02-12T01:54:18.775Z] [1770861258774-rz5am0kxf][sess-a1b2c3d4e5f6] debug [PrismaConnectionMiddleware] Verificando conexão... User:1 GET /v1/territories?round=1 +61ms
[2026-02-12T01:54:18.776Z] [1770861258774-rz5am0kxf][sess-a1b2c3d4e5f6] debug [AuthGuard] Rota privada User:1 GET /v1/territories?round=1 +1ms
[2026-02-12T01:54:18.778Z] [1770861258774-rz5am0kxf][sess-a1b2c3d4e5f6] info [TerritoryService] Buscando territórios... User:1 GET /v1/territories?round=1 +2ms
[2026-02-12T01:54:19.651Z] [1770861258774-rz5am0kxf][sess-a1b2c3d4e5f6] info [TerritoryService] Territórios encontrados: 37 User:1 GET /v1/territories?round=1 +873ms

# ============================================
# SESSÃO 2: João Silva (User ID: 99)
# IP: 192.168.1.100 (mesmo IP!)
# SessionId: sess-{hash(192.168.1.100:99)} ← Hash diferente!
# ============================================

# Requisição 3: Login de outro usuário no MESMO IP
[2026-02-12T01:54:20.123Z] [1770861260123-abc123xyz][sess-x9y8z7w6v5u4] debug [AuthGuard] Rota pública - /v1/login - POST +0ms
[2026-02-12T01:54:20.124Z] [1770861260123-abc123xyz][sess-x9y8z7w6v5u4] info [AuthService] login joao@email.com POST /v1/login +1ms
[2026-02-12T01:54:20.245Z] [1770861260123-abc123xyz][sess-x9y8z7w6v5u4] info [AuthService] Gerando token joao@email.com POST /v1/login +121ms
```

## Interpretação

### TraceId (por requisição)
- `1770861258453-frxhb9utx` - Login do Wilson
- `1770861258774-rz5am0kxf` - Busca de territórios do Wilson
- `1770861260123-abc123xyz` - Login do João

**Cada requisição = TraceId único**

### SessionId (por IP + userId)
- `sess-a1b2c3d4e5f6` - IP: 192.168.1.100 + User: 1 (Wilson)
- `sess-x9y8z7w6v5u4` - IP: 192.168.1.100 + User: 99 (João)

**✅ Mesmo IP + usuários diferentes = SessionIds diferentes!**  
**✅ Mesmo IP + mesmo usuário = SessionId idêntico em múltiplas requisições!**

## CloudWatch Logs Insights - Queries Úteis

### Fórmula:
```
Antes do login:  SessionId = sess-{SHA256(ip).substring(0,16)}
Depois do login: SessionId = sess-{SHA256(ip:userId).substring(0,16)}
```

### Exemplos Práticos:

**Cenário 1: Usuário não autenticado**
```
IP: 192.168.1.100
SessionId: sess-a1b2c3d4e5f6  ← hash(192.168.1.100)
```

**Cenário 2: Wilson autenticado (userId=1)**
```
IP: 192.168.1.100 + userId: 1
SessionId: sess-a1b2c3d4e5f6  ← hash(192.168.1.100:1)
```

**Cenário 3: João autenticado (userId=99) no MESMO IP**
```
IP: 192.168.1.100 + userId: 99
SessionId: sess-x9y8z7w6v5u4  ← hash(192.168.1.100:99) ✅ Diferente!
```

**Cenário 4: Wilson muda de WiFi para 4G**
```
IP: 10.20.30.40 (novo) + userId: 1
SessionId: sess-xyz789abc  ← hash(10.20.30.40:1) ⚠️ Mudou (esperado)
```

### 1. Ver jornada completa do Wilson (SessionId)
```sql
fields @timestamp, traceId, method, url, message, userId
| filter sessionId = "sess-a1b2c3d4e5f6"
| sort @timestamp asc
```

**Resultado:**
```
@timestamp                 traceId                  method  url                      message                    userId
2026-02-12T01:54:18.453Z  1770861258453-frxhb9utx  POST    /v1/login               login wfelipe2011@...      null
2026-02-12T01:54:18.714Z  1770861258453-frxhb9utx  POST    /v1/login               Gerando token              null
2026-02-12T01:54:18.775Z  1770861258774-rz5am0kxf  GET     /v1/territories?round=1 Verificando conexão...     1
2026-02-12T01:54:19.651Z  1770861258774-rz5am0kxf  GET     /v1/territories?round=1 Territórios encontrados    1
```

### 2. Rastrear requisição específica do login (TraceId)
```sql
fields @timestamp, level, message, context
| filter traceId = "1770861258453-frxhb9utx"
| sort @timestamp asc
```

**Resultado:**
```
@timestamp                 level   message                          context
2026-02-12T01:54:18.453Z  debug   Rota pública - /v1/login - POST  AuthGuard
2026-02-12T01:54:18.454Z  info    login wfelipe2011@gmail.com      AuthService
2026-02-12T01:54:18.639Z  info    Verificando senha...             AuthService
2026-02-12T01:54:18.714Z  info    Gerando token...                 AuthService
```

## Integração com Frontend

### ✅ Não É Necessário Armazenar SessionId

O servidor calcula automaticamente baseado em `IP + userId` extraído do token JWT.

```javascript
// ❌ NÃO é necessário fazer isso:
// const sessionId = localStorage.getItem('sessionId');

// ✅ Apenas envie o token normalmente:
fetch('/api/territories', {
  headers: {
    'Authorization': `Bearer ${token}`,  // userId extraído daqui
  }
});

// O servidor retorna o sessionId calculado no header (opcional para debug):
// X-Session-Id: sess-a1b2c3d4e5f6
```

### React/Vue/Angular (SPA)
```javascript
// src/services/api.js
export const apiClient = axios.create({
  baseURL: '/api',
});

// Capturar traceId e sessionId das respostas apenas para debug
apiClient.interceptors.response.use(
  response => {
    const traceId = response.headers['x-trace-id'];
    const sessionId = response.headers['x-session-id'];
    console.debug(`TraceId: ${traceId}, SessionId: ${sessionId}`);
    return response;
  },
  error => {
    const traceId = error.response?.headers['x-trace-id'];
    console.error(`Erro - TraceId: ${traceId}`);
    throw error;
  }
);
```

### React Native / Mobile
```javascript
// src/utils/api.js

export async function fetchAPI(url, options = {}) {
  const token = await AsyncStorage.getItem('authToken');
  
  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,  // ✅ userId extraído automaticamente
    }
  });
  
  // Para debug: capturar IDs dos headers
  const traceId = response.headers.get('x-trace-id');
  const sessionId = response.headers.get('x-session-id');
  console.debug(`TraceId: ${traceId}, SessionId: ${sessionId}`);
  
  return response.json();
}
```

## Vantagens Práticas

### ✅ Cenário 1: Bug Intermitente
**Problema:** "Às vezes o login falha, mas não consigo reproduzir"

**Solução com SessionId:**
```sql
# Ver TODAS as tentativas de login daquele dispositivo
fields @timestamp, traceId, method, url, level, message
| filter sessionId = "sess-a1b2c3d4e5f6" and url like "/login"
| sort @timestamp asc
```

### ✅ Cenário 2: Rastreamento de Erro
**Problema:** "Cliente reportou erro, enviou print da tela"

**Solução com TraceId:**
- Cliente copia o traceId do console/alerta
- Backend busca logs exatos daquela requisição:
```sql
fields @timestamp, level, message, context
| filter traceId = "1770861258453-frxhb9utx"
```

### ✅ Cenário 3: Análise de Comportamento
**Problema:** "Usuários estão fazendo muitas requisições desnecessárias?"

**Solução com SessionId:**
```sql
# Contar requisições por sessão
fields sessionId, userId, userAgent
| stats count() as totalRequests by sessionId, userId, userAgent
| sort totalRequests desc
| limit 50
```

## Headers no Postman/Insomnia

```bash
# Enviar apenas o token de autenticação
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# ✅ Backend calcula automaticamente:
# - IP da requisição
# - userId extraído do token
# - SessionId = hash(IP:userId)

# Backend retorna nos headers da resposta:
X-Trace-Id: 1770861258453-frxhb9utx
X-Session-Id: sess-a1b2c3d4e5f6
```

**Nota:** Não é necessário armazenar ou reenviar `X-Session-Id`. Ele será sempre o mesmo para as requisições do mesmo IP + usuário.

---

**Gerado em:** 12/02/2026  
**Status:** ✅ Implementado e Testado
