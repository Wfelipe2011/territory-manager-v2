import { Body, Controller, Get, Post, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/decorators/public.decorator';
import { AdminRegisterInput, LoginInput, LoginOutput, PublicRegisterInput, UserOutput } from './contracts';
import { VERSION } from 'src/enum/version.enum';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enum/role.enum';
import { RequestUser } from 'src/interfaces/RequestUser';

@ApiTags('Autenticação')
@Controller({
  version: VERSION.V1,
})
export class AuthController {
  constructor(readonly authService: AuthService) { }

  @Public()
  @ApiOperation({ summary: 'Autenticação de usuário' })
  @ApiResponse({ status: 200, description: 'Usuário logado com sucesso', type: LoginOutput })
  @Post('login')
  async login(@Body() loginDto: LoginInput) {
    return this.authService.login(loginDto.email.toLocaleLowerCase(), loginDto.password);
  }

  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Registro de novo administrador (Restrito)' })
  @Post('auth/admin/register')
  async adminRegister(@Body() input: AdminRegisterInput, @Request() req: RequestUser) {
    return this.authService.adminRegister(input, req.user.tenantId);
  }

  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Lista usuários do tenant (Restrito)' })
  @ApiResponse({ status: 200, type: UserOutput, isArray: true })
  @Get('auth/admin/users')
  async listUsers(@Request() req: RequestUser) {
    return this.authService.listUsers(req.user.tenantId);
  }

  @Public()
  @ApiOperation({ summary: 'Registro público (Novo Usuário + Novo Tenant)' })
  @Post('auth/public/register')
  async publicRegister(@Body() input: PublicRegisterInput) {
    return this.authService.publicRegister(input);
  }

  @Public()
  @ApiOperation({ summary: 'Recuperação de senha' })
  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }) {
    return this.authService.forgotPassword(body.email.toLocaleLowerCase());
  }

  @Public()
  @ApiOperation({ summary: 'Reset de senha' })
  @Post('reset-password')
  async resetPassword(@Body() body: { token: string; password: string }) {
    return this.authService.resetPassword(body.token, body.password);
  }

  @Public()
  @Post('hash-password')
  async hashPassword(@Body() body: { password: string }) {
    return this.authService.hashPassword(body.password);
  }
}
