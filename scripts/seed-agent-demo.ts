import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { resolve } from 'path';

async function main() {
  const database = new URL(process.env.DATABASE_URL!);
  if (process.env.NODE_ENV === 'production' || !['db', 'localhost', '127.0.0.1'].includes(database.hostname)) throw new Error('Fixture permitida somente no ambiente local');
  const prisma = new PrismaClient();
  try {
    const accounts: object[] = [];
    for (const suffix of ['principal', 'isolamento']) {
      const name = `QA Integrações MCP ${suffix}`;
      let tenant = await prisma.multitenancy.findFirst({ where: { name } });
      if (!tenant) tenant = await prisma.multitenancy.create({ data: { name } });
      const email = `qa-mcp-${suffix}@local.test`;
      const password = randomBytes(18).toString('base64url');
      await prisma.user.upsert({ where: { email }, create: { tenantId: tenant.id, name: 'Administrador de demonstração MCP', email, password: await hash(password, 10) }, update: { password: await hash(password, 10) } });
      for (const typeName of ['Residencial', 'Comercial']) {
        let type = await prisma.type.findFirst({ where: { tenantId: tenant.id, name: typeName } });
        if (!type) type = await prisma.type.create({ data: { tenantId: tenant.id, name: typeName } });
        if (!await prisma.territory.findFirst({ where: { tenantId: tenant.id, name: `Demonstração ${typeName}` } })) await prisma.territory.create({ data: { tenantId: tenant.id, typeId: type.id, name: `Demonstração ${typeName}` } });
      }
      accounts.push({ email, password, tenantId: tenant.id, congregation: name });
    }
    const dir = resolve('.agent-runtime');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = resolve(dir, 'demo-accounts.json');
    await writeFile(path, JSON.stringify(accounts, null, 2), { mode: 0o600 });
    console.log(`Contas sintéticas criadas. Credenciais somente no arquivo privado ${path}`);
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
