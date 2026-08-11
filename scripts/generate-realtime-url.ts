import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

import { PrismaClient } from '@prisma/client';
import * as jwt from 'jsonwebtoken';

interface CliArgs {
  territory: number;
  round: number;
  port: number;
  host: string;
  userId: number;
  tenantId: number;
  expirationSeconds: number;
  userName: string;
  roles: string[];
}

function parseCli(): CliArgs {
  const parsed = parseArgs({
    options: {
      territory: { type: 'string', default: '23' },
      round: { type: 'string', default: '10' },
      port: { type: 'string', default: '3002' },
      host: { type: 'string', default: 'localhost' },
      'user-id': { type: 'string', default: '42' },
      'tenant-id': { type: 'string', default: '2' },
      'expiration-seconds': { type: 'string', default: '3600' },
      'user-name': { type: 'string', default: 'Test User' },
      roles: { type: 'string', default: 'admin' },
    },
    allowPositionals: false,
  });

  return {
    territory: intOrThrow(parsed.values.territory, 'territory'),
    round: intOrThrow(parsed.values.round, 'round'),
    port: intOrThrow(parsed.values.port, 'port'),
    host: parsed.values.host as string,
    userId: intOrThrow(parsed.values['user-id'], 'user-id'),
    tenantId: intOrThrow(parsed.values['tenant-id'], 'tenant-id'),
    expirationSeconds: intOrThrow(parsed.values['expiration-seconds'], 'expiration-seconds'),
    userName: parsed.values['user-name'] as string,
    roles: (parsed.values.roles as string).split(',').map((r) => r.trim()).filter(Boolean),
  };
}

function intOrThrow(value: string | undefined, field: string): number {
  if (value === undefined) throw new Error(`--${field} faltando`);
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${field} deve ser inteiro positivo (recebido: ${value})`);
  return n;
}

async function main() {
  const args = parseCli();
  const jwtSecret = process.env.JWT_SECRET ?? 'test_secret';

  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.multitenancy.findUnique({ where: { id: args.tenantId } });
    if (!tenant) {
      throw new Error(`Tenant ${args.tenantId} não existe. Verifique a tabela multi_tenancy.`);
    }

    const territory = await prisma.territory.findUnique({ where: { id: args.territory } });
    if (!territory) {
      throw new Error(`Território ${args.territory} não existe.`);
    }

    const identityId = randomUUID();
    const expirationSeconds = args.expirationSeconds;
    const expirationDate = new Date(Date.now() + expirationSeconds * 1000);

    const token = jwt.sign(
      {
        id: identityId,
        userId: args.userId,
        userName: args.userName,
        territoryId: args.territory,
        blockId: territory.id,
        addressId: 2,
        round: args.round,
        roles: args.roles,
        tenantId: args.tenantId,
      },
      jwtSecret,
      { expiresIn: expirationSeconds },
    );

    const key = randomUUID();
    await prisma.signature.create({
      data: {
        key,
        token,
        expirationDate,
        tenantId: args.tenantId,
      },
    });

    const p = `territorio/${args.territory}?round=${args.round}`;
    const url = `http://${args.host}:${args.port}/home?p=${encodeURIComponent(p)}&s=${key}`;

    console.log(url);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`[generate-realtime-url] erro: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
