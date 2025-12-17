import * as jwt from 'jsonwebtoken';
import { envs } from '../../src/infra/envs';
import { uuid } from '../../src/shared/uuid.shared';

export const createTestToken = (payload: { userId?: number; userName?: string; tenantId?: number; roles?: string[] } = {}) => {
    return jwt.sign(
        {
            id: uuid(),
            userId: payload.userId || 1,
            userName: payload.userName || 'Test User',
            roles: payload.roles || ['admin'],
            tenantId: payload.tenantId || 1,
        },
        envs.JWT_SECRET || 'test_secret',
        {
            expiresIn: '1d',
        }
    );
};
