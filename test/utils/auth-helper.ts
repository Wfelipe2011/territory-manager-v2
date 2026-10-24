import { Role } from '../../src/enum/role.enum';
import * as jwt from 'jsonwebtoken';
import { envs } from '../../src/infra/envs';
import { uuid } from '../../src/shared/uuid.shared';

export const createTestToken = (payload: any = {}) => {
    return jwt.sign(
        {
            id: payload.id || uuid(),
            userId: payload.userId || 1,
            userName: payload.userName || 'Test User',
            roles: payload.roles || ['admin'],
            tenantId: payload.tenantId || 1,
            ...payload,
        },
        envs.JWT_SECRET || 'test_secret',
        {
            expiresIn: '1d',
        }
    );
};


// Real, expiring capabilities for tests that exercise mobile authorization.
export async function createFieldTestToken(prisma: import('@prisma/client').PrismaClient, payload: { tenantId: number; territoryId: number; blockId?: number; round?: number; roles: Role[] }) {
  const id = uuid();
  const token = createTestToken({ ...payload, id, round: payload.round ?? 1 });
  await prisma.signature.create({ data: { key: id, token, tenantId: payload.tenantId, expirationDate: new Date(Date.now() + 86400000) } });
  return token;
}
