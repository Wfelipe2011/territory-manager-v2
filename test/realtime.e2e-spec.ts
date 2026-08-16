import { INestApplication } from '@nestjs/common';
import { createParser, EventSourceParserStream, ParsedEvent, ReconnectInterval } from 'eventsource-parser';
import * as http from 'http';
import * as jwt from 'jsonwebtoken';
import { URL } from 'url';

import { envs } from '../src/infra/envs';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { uuid } from '../src/shared/uuid.shared';
import { cleanDatabase } from './utils/db-cleaner';
import { socketApp } from './utils/realtime-app-helper';

interface SSEEvent {
  id?: string;
  event: string;
  data: any;
}

const COLLECT_MS = 2500;

class SSEClient {
  public events: SSEEvent[] = [];
  public closed = false;
  public statusCode = 0;
  private buffer = '';

  constructor(
    private req: http.ClientRequest,
    private res: http.IncomingMessage
  ) {
    this.statusCode = res.statusCode ?? 0;
    res.setEncoding('utf8');
    const parser = createParser({
      onEvent: (evt: ParsedEvent | ReconnectInterval) => {
        if ('id' in evt && (evt as ParsedEvent).data !== undefined) {
          const e = evt as ParsedEvent;
          let parsed: any = e.data;
          try {
            parsed = JSON.parse(e.data);
          } catch {
            /* keep raw */
          }
          this.events.push({ id: e.id, event: e.event || 'message', data: parsed });
        }
      },
    });
    res.on('data', (chunk: string) => {
      this.buffer += chunk;
      parser.feed(chunk);
    });
    res.on('end', () => {
      this.closed = true;
    });
    res.on('close', () => {
      this.closed = true;
    });
    res.on('error', () => {
      this.closed = true;
    });
  }

  close(): void {
    if (!this.closed) {
      try {
        this.req.destroy();
      } catch {
        /* ignore */
      }
      this.closed = true;
    }
  }

  wait(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  async collectFor(ms: number): Promise<void> {
    await this.wait(ms);
  }

  lastOfType(type: string): SSEEvent | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].event === type) return this.events[i];
    }
    return undefined;
  }

  countOfType(type: string): number {
    return this.events.filter(e => e.event === type).length;
  }
}

function openSSE(path: string): Promise<SSEClient> {
  return new Promise((resolve, reject) => {
    const url = new URL(path);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Connection: 'keep-alive',
        },
      },
      res => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        res.setEncoding('utf8');
        const client = new SSEClient(req, res);
        resolve(client);
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function seedSignature(
  prisma: PrismaService,
  overrides: { expiresInSeconds?: number; tenantId?: number; userId?: number; tokenPayload?: Record<string, any> } = {}
) {
  const tenantId = overrides.tenantId ?? 1;
  const userId = overrides.userId ?? 42;
  const expiresInSeconds = overrides.expiresInSeconds ?? 3600;
  await seedMinimalFixtures(prisma);
  const identityId = uuid();
  const token = jwt.sign(
    {
      id: identityId,
      userId,
      userName: 'Test User',
      territoryId: 67,
      blockId: 22,
      addressId: 2,
      round: 22,
      roles: ['admin'],
      tenantId,
      ...overrides.tokenPayload,
    },
    envs.JWT_SECRET || 'test_secret',
    { expiresIn: `${expiresInSeconds}s` }
  );
  const expirationDate = new Date(Date.now() + expiresInSeconds * 1000);
  const signature = await prisma.signature.create({
    data: {
      key: uuid(),
      token,
      expirationDate,
      tenantId,
    },
  });
  return { signature, identityId, token, expirationDate };
}

async function seedMinimalFixtures(prisma: PrismaService) {
  const tenant = await prisma.multitenancy.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, name: 'Test Tenant', city: 'Test', state: 'SP' },
  });
  await prisma.user.upsert({
    where: { id: 42 },
    update: {},
    create: { id: 42, name: 'Test User', email: 'test@td.local', password: 'x', tenantId: tenant.id },
  });
  return { tenant };
}

describe('Realtime SSE (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let port: number;
  const clients: SSEClient[] = [];

  beforeAll(async () => {
    app = await socketApp();
    prisma = app.get(PrismaService);
    await app.listen(0);
    port = app.getHttpServer().address().port;
    await seedMinimalFixtures(prisma);
  }, 30000);

  afterAll(async () => {
    for (const c of clients) c.close();
    if (app) await app.close();
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await cleanDatabase(prisma);
  });

  function track(c: SSEClient) {
    clients.push(c);
    return c;
  }

  it('GET /v1/realtime/street sem assinatura emite erro de auth', async () => {
    const sse = track(await openSSE(`http://127.0.0.1:${port}/v1/realtime/street/67/22/2?round=22`));
    await sse.collectFor(COLLECT_MS);
    const errEvt = sse.events.find(e => e.event === 'error' || (typeof e.data === 'object' && e.data && (e.data as any).reason));
    expect(errEvt).toBeDefined();
  });

  it('GET /v1/realtime/street com s= inválido emite erro de auth', async () => {
    const sse = track(await openSSE(`http://127.0.0.1:${port}/v1/realtime/street/67/22/2?round=22&s=00000000-0000-0000-0000-000000000000`));
    await sse.collectFor(COLLECT_MS);
    const errEvt = sse.events.find(e => e.event === 'error' || (typeof e.data === 'object' && e.data && (e.data as any).reason));
    expect(errEvt).toBeDefined();
  });

  it('SSE válido: emite `connected` + `presence_changed` (count=1)', async () => {
    const { signature } = await seedSignature(prisma);
    const sse = track(await openSSE(`http://127.0.0.1:${port}/v1/realtime/street/67/22/2?round=22&s=${signature.key}`));
    await sse.collectFor(COLLECT_MS);

    const connected = sse.lastOfType('connected');
    expect(connected).toBeDefined();
    expect(connected!.data.streetKey).toBe('house:67:22:2:22');

    const presence = sse.lastOfType('presence_changed');
    expect(presence).toBeDefined();
    expect(presence!.data.userCount).toBe(1);
  });

  it('2 conexões na mesma assinatura → userCount=1 (deduplicado por identity_key)', async () => {
    const { signature } = await seedSignature(prisma);
    const a = track(await openSSE(`http://127.0.0.1:${port}/v1/realtime/street/67/22/2?round=22&s=${signature.key}`));
    const b = track(await openSSE(`http://127.0.0.1:${port}/v1/realtime/street/67/22/2?round=22&s=${signature.key}`));

    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 300));
      if (a.lastOfType('presence_changed') && b.lastOfType('presence_changed')) break;
    }

    const aPresence = a.lastOfType('presence_changed');
    const bPresence = b.lastOfType('presence_changed');
    expect(aPresence).toBeDefined();
    expect(bPresence).toBeDefined();
    expect(aPresence!.data.userCount).toBe(1);
    expect(bPresence!.data.userCount).toBe(1);

    const distinctUsers = await prisma.street_presence.groupBy({
      by: ['identityKey'],
      where: { streetKey: 'house:67:22:2:22' },
    });
    expect(distinctUsers.length).toBe(1);

    const rowCount = await prisma.street_presence.count();
    expect(rowCount).toBeGreaterThanOrEqual(2);
  });

  it('Desconexão → presence removida', async () => {
    const { signature } = await seedSignature(prisma);
    const sse = track(await openSSE(`http://127.0.0.1:${port}/v1/realtime/street/67/22/2?round=22&s=${signature.key}`));
    await sse.collectFor(800);
    expect(await prisma.street_presence.count()).toBe(1);
    sse.close();
    await new Promise(r => setTimeout(r, 1500));
    expect(await prisma.street_presence.count()).toBe(0);
  });
});
