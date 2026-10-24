/** Local-only, isolated QA congregation. Does not alter restored congregation data. */
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { SignatureService } from '../src/modules/signature/signature.service';
import { ParametersService } from '../src/modules/parameters/parameters.service';
import { envs } from '../src/infra/envs';

async function main() {
  const database = new URL(process.env.DATABASE_URL!);
  if (process.env.NODE_ENV === 'production' || !['db', 'localhost', '127.0.0.1'].includes(database.hostname)) throw new Error('Fixture permitida somente no ambiente local');
  const prisma = new PrismaClient();
  try {
    const name = 'QA Frontend Unificado';
    let tenant = await prisma.multitenancy.findFirst({ where: { name } });
    if (!tenant) {
      tenant = await prisma.multitenancy.create({ data: { name, city: 'Sorocaba', state: 'SP', phone: '11999990000' } });
      const tenantId = tenant.id;
      const type = await prisma.type.create({ data: { name: 'Residencial', tenantId } });
      const territory = await prisma.territory.create({ data: { name: 'Território de demonstração', imageUrl: 'http://localhost:4800/logo.png', tenantId, typeId: type.id } });
      await prisma.round_info.create({ data: { roundNumber: 1, name: 'Rodada de demonstração', tenantId, theme: 'letters', colorPrimary: '#8B5E34', colorSecondary: '#F3E8D9' } });
      for (let b = 1; b <= 2; b++) {
        const block = await prisma.block.create({ data: { name: `Quadra ${b}`, tenantId } });
        const link = await prisma.territory_block.create({ data: { tenantId, territoryId: territory.id, blockId: block.id } });
        for (let a = 1; a <= 2; a++) {
          const address = await prisma.address.create({ data: { name: `Rua de demonstração ${b}.${a}`, tenantId } });
          const mapping = await prisma.territory_block_address.create({ data: { tenantId, territoryBlockId: link.id, addressId: address.id } });
          for (let n = 1; n <= 6; n++) {
            const house = await prisma.house.create({ data: { tenantId, territoryId: territory.id, blockId: block.id, addressId: address.id, territoryBlockAddressId: mapping.id, number: String(n * 2 + 100), legend: n === 3 ? 'Comércio' : 'Residência', dontVisit: n === 2 } });
            await prisma.round.create({ data: { tenantId, territoryId: territory.id, blockId: block.id, houseId: house.id, roundNumber: 1, completed: n === 6, completedDate: n === 6 ? new Date() : null, leaveLetter: n === 4, mode: 'letters' } });
          }
        }
      }
    }
    const tenantId = tenant.id;
    const email = 'qa-campo@local.test';
    await prisma.user.upsert({ where: { email }, update: {}, create: { tenantId, name: 'Administrador QA', email, password: await hash('admin123', 10) } });
    const territory = await prisma.territory.findFirstOrThrow({ where: { tenantId, name: 'Território de demonstração' } });
    await prisma.round_info.updateMany({where:{tenantId,roundNumber:1},data:{typeIds:[territory.typeId],status:'open',type:'Residencial'}});
    const blankType=await prisma.type.create({data:{tenantId,name:`QA Cadastro ${Date.now()}`}});
    const blank=await prisma.territory.create({data:{tenantId,typeId:blankType.id,name:`QA Território vazio ${Date.now()}`}});
    const service = new SignatureService(prisma as any, new ParametersService(prisma as any));
    let leader = await prisma.territory_overseer.findFirst({ where: { tenantId, territoryId: territory.id, signature: { expirationDate: { gt: new Date() } } }, include: { signature: true } });
    if (!leader?.signature) {
      const expires = new Date(); expires.setDate(expires.getDate() + 7);
      await service.generateTerritory({ tenantId, territoryId: territory.id, round: 1, overseer: 'Dirigente QA', expirationTime: expires.toISOString().slice(0, 10) });
      leader = await prisma.territory_overseer.findFirstOrThrow({ where: { tenantId, territoryId: territory.id, signatureId: { not: null } }, include: { signature: true } });
    }
    const key = randomUUID();
    const expirationDate = new Date(Date.now() + 7 * 86400000);
    const token = jwt.sign({ id: key, tenantId, territoryId: territory.id, round: 1, roles: ['overseer'], overseer: 'Dirigente QA' }, envs.JWT_SECRET, { expiresIn: '7d' });
    await prisma.signature.create({ data: { key, token, tenantId, expirationDate } });
    console.log(JSON.stringify({ tenantId, blankTerritoryId: blank.id, blankTypeId: blankType.id, blankName: blank.name, territoryId: territory.id, leaderCode: leader!.signature!.key, legacyCode: key, email, leaderUrl: `http://localhost:4800/acesso/${leader!.signature!.key}` }));
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
