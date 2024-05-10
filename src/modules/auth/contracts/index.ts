import { ApiProperty } from '@nestjs/swagger';
import { Role } from 'src/enum/role.enum';

export class LoginInput {
  @ApiProperty({ description: 'Email do usuário', example: 'john@gmail.com', required: true })
  email: string;
  @ApiProperty({ description: 'Senha do usuário', example: '123456', required: true })
  password: string;
}

export class LoginOutput {
  @ApiProperty({ description: 'Token JWT', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  token: string;
}

export class UserToken {
  id: string;
  userId: number;
  tenantId: number;
  roles: Role[];
  constructor(id: string, userId: number, tenancy: number, roles: Role[]) {
    this.id = id;
    this.userId = userId;
    this.tenantId = tenancy;
    this.roles = roles;
  }
}
