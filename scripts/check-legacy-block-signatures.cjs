// Read-only cutover check; print record IDs and counts, never keys or JWTs.
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
async function check(prisma) {
  const rows = await prisma.territory_block.findMany({ where: { signatureId: { not: null } }, include: { signature: true } });
  const issues = [], now = Date.now(); let importable = 0;
  const seen = new Set();
  for (const row of rows) {
    const signature = row.signature, grant = signature && jwt.decode(signature.token);
    const round = grant?.round == null ? 0 : Number(grant.round);
    const valid = grant && typeof grant === 'object' && grant.id === signature.key &&
      signature.tenantId === row.tenantId && Number(grant.tenantId) === row.tenantId &&
      Number(grant.territoryId) === row.territoryId && Number(grant.blockId) === row.blockId &&
      Array.isArray(grant.roles) && grant.roles.includes('publisher') &&
      Number.isSafeInteger(round) && round >= (grant.round == null ? 0 : 1) && round <= 2147483647;
    if (valid) {
      if (seen.has(signature.id)) issues.push({ territoryBlockId: row.id, reason: 'duplicate_signature' });
      seen.add(signature.id); importable++;
    } else if (signature?.expirationDate && +signature.expirationDate > now) {
      issues.push({ territoryBlockId: row.id, reason: 'invalid_live_scope' });
    }
  }
  return { legacyAssociations: rows.length, importable, issues, ready: issues.length === 0 };
}
module.exports = { check };
if (require.main === module) {
  const prisma = new PrismaClient();
  check(prisma).then(result => { console.log(JSON.stringify(result, null, 2)); if (!result.ready) process.exitCode = 2; })
    .catch(() => { console.error('Legacy signature check failed; inspect database connectivity.'); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
