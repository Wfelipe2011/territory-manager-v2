# Integração de Logs com AWS CloudWatch no NestJS

Este documento apresenta uma pesquisa sobre como integrar os logs da aplicação com o AWS CloudWatch, sugestões de implementação, boas práticas, custos e uma análise do estado atual do projeto.

## 1. Pesquisa e Referências

A integração do NestJS com o CloudWatch é comumente realizada utilizando a biblioteca `winston` como base, devido à sua flexibilidade e suporte ao ecossistema NestJS via `nest-winston`.

*   **Winston + CloudWatch**: A abordagem padrão de mercado é utilizar o *transport* `winston-cloudwatch`. Isso permite que os logs gerados pelo `Logger` do NestJS sejam enviados assincronamente para o CloudWatch Logs.
*   **JSON Logs**: O CloudWatch processa melhor logs estruturados em JSON. Isso permite filtrar logs por campos específicos (ex: `level="error"`, `context="AuthModule"`).
*   **Links Analisados**:
    *   *NestJS Docs*: Recomendam o uso de loggers customizados para produção.
    *   *StackOverflow/Medium*: Reforçam o uso de `winston` para gerenciar múltiplos "transports" (Console para dev, CloudWatch/File para prod).

## 2. Análise do Projeto Atual

O projeto `territory-manager` já possui uma base sólida para logging instalada.

*   **Dependências Existentes**:
    *   `winston`: Já instalado.
    *   `nest-winston`: Já instalado (módulo oficial do Nest para Winston).
    *   `winston-daily-rotate-file`: Já instalado (provavelmente para logs locais em arquivo).
    *   `@logtail/winston`: Instalado (indica uma possível integração anterior ou paralela com o serviço Logtail).
*   **Setup Atual**: O arquivo `src/main.ts` utiliza o logger padrão. Para ativar o Winston, será necessário configurar o `WinstonModule` no `AppModule` e substituir o logger padrão na inicialização.

**Conclusão**: O projeto está 90% pronto para a integração. Falta apenas instalar o transport do CloudWatch e configurar o módulo.

## 3. Sugestão de Implementação

### Passo 1: Instalação
É necessário instalar a biblioteca de transporte para o CloudWatch:

```bash
npm install winston-cloudwatch
npm install --save-dev @types/winston-cloudwatch
```

### Passo 2: Configuração Ideal (WinstonModule)
No `src/app.module.ts`, configure o `WinstonModule` para usar o CloudWatch apenas em produção ou quando as credenciais estiverem presentes.

```typescript
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import WinstonCloudWatch from 'winston-cloudwatch';

// No imports do @Module:
WinstonModule.forRoot({
  transports: [
    // Logs no Console (Desenvolvimento)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.ms(),
        winston.format.colorize(), // Apenas para console
        winston.format.simple(), // Ou nestLike()
      ),
    }),
    // Logs no CloudWatch (Produção)
    new WinstonCloudWatch({
      logGroupName: 'territory-manager-production',
      logStreamName: `instance-${process.env.HOSTNAME || 'local'}`,
      awsRegion: process.env.AWS_REGION || 'us-east-1',
      jsonMessage: true, // Importante para estruturar os dados
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }),
  ],
});
```

### Passo 3: Substituir Logger Global
No `src/main.ts`, instrua o Nest a usar o Winston:

```typescript
const app = await NestFactory.create(AppModule, { bufferLogs: true });
// Recupera a instância do logger criada pelo módulo
app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
```

## 4. Boas Práticas

1.  **Use JSON em Produção**: Logs de texto simples são difíceis de consultar. Configure o Winston para formatar como JSON no CloudWatch.
2.  **Contexto**: Sempre use `private readonly logger = new Logger(NomeDaClasse.name)` nas classes. O CloudWatch permitirá filtrar logs apenas dessa classe.
3.  **Log Levels**:
    *   `ERROR`: Falhas que precisam de atenção imediata.
    *   `WARN`: Situações inesperadas mas recuperáveis.
    *   `LOG/INFO`: Fluxo normal de operação importante (ex: "Usuário X criou território Y").
    *   `DEBUG`: Dados brutos para desenvolvimento (evite enviar para o CloudWatch para economizar custos).
4.  **Tratamento de Erros no Transport**: O `winston-cloudwatch` pode falhar se a rede cair. Certifique-se de ter um fallback (o Console log geralmente serve para o stderr do container).
5.  **Retention Policy**: Configure no AWS CloudWatch uma política de retenção (ex: 30 dias) para não acumular logs (e custos) infinitamente.

## 5. Custos (Estimativa AWS)

O CloudWatch Logs cobra por:
1.  **Ingestão**: Preço por GB enviado (aprox. $0.50 a $0.70 USD/GB dependendo da região).
2.  **Armazenamento**: Preço por GB armazenado (aprox. $0.03 USD/GB).
3.  **Insights (Queries)**: Preço por GB escaneado ao fazer buscas (aprox. $0.005 USD/GB).

**Como economizar**:
*   Não envie logs de nível `DEBUG` ou `VERBOSE` para o CloudWatch em produção.
*   Evite logar objetos gigantes (ex: base64 de imagens, retornos inteiros do banco de dados).
*   Defina a retenção do Log Group para 14 ou 30 dias (padrão é "Never Expire").
