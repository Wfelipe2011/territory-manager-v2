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
