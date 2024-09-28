import { Request } from 'express';
import { Role } from 'src/enum/role.enum';
import { UserToken } from 'src/modules/auth/contracts';

export interface RequestUser extends Request {
  user: UserToken;
}

export interface RequestSignature extends Request {
  user: { id: string; territoryId: number; blockId: number; roles: Role[]; round: string; tenantId: number; userId: number; userName: string };
}
