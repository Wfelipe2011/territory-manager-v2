/** Local QA only: reproduces a legacy UUID in one round and a new assignment in another. */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { SignatureService } from '../src/modules/signature/signature.service';
import { ParametersService } from '../src/modules/parameters/parameters.service';
import { envs } from '../src/infra/envs';
async function main() {
  const database = new URL(process.env.DATABASE_URL!);
  if (process.env.NODE_ENV === 'production' || !['db','localhost','127.0.0.1'].includes(database.hostname)) throw new Error('Fixture somente local');
  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.multitenancy.findFirstOrThrow({ where: { name: 'QA Frontend Unificado' } });
    const tenantId = tenant.id;
    const type = await prisma.type.findFirstOrThrow({ where: { tenantId, name: 'Residencial' } });
    const territory = await prisma.territory.create({ data: { tenantId, typeId: type.id, name: `QA Links por rodada ${Date.now()}` } });
    const block = await prisma.block.create({ data: { tenantId, name: 'Quadra QA Compartilhar' } });
    const link = await prisma.territory_block.create({ data: { tenantId, territoryId: territory.id, blockId: block.id } });
    const last = (await prisma.round_info.aggregate({ where: { tenantId }, _max: { roundNumber: true } }))._max.roundNumber ?? 0;
    const rounds = [last+1,last+2];
    for (const roundNumber of rounds) await prisma.round_info.create({ data: { tenantId, roundNumber, type: type.name, typeIds: [type.id], name: `QA Compartilhar ${roundNumber}`, theme: 'default' } });
    const key = randomUUID(), expirationDate = new Date(Date.now() + 365*86400000);
    const token = jwt.sign({ id: key, tenantId, territoryId: territory.id, blockId: block.id, round: rounds[0], roles: ['publisher'] }, envs.JWT_SECRET, { expiresIn: '365d' });
    const old = await prisma.signature.create({ data: { key, token, tenantId, expirationDate } });
    await prisma.territory_block.update({ where: { id: link.id }, data: { signatureId: old.id } });
    const signatures = new SignatureService(prisma as any, new ParametersService(prisma as any));
    const leaderCodes = [];
    for (const round of rounds) leaderCodes.push((await signatures.generateTerritory({ tenantId, territoryId: territory.id, round, overseer: 'Dirigente QA Links', expirationTime: '2099-12-31' })).signature);
    console.log(JSON.stringify({ tenantId, territoryId: territory.id, blockId: block.id, blockName: block.name, rounds, leaderCodes, oldCode: key, oldExpirationDate: expirationDate }));
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
