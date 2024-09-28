import { Body, Controller, Post, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/decorators/public.decorator';
import { LoginInput, LoginOutput } from './contracts';
import { VERSION } from 'src/enum/version.enum';

@ApiTags('Autenticação')
@Controller({
  version: VERSION.V1,
})
export class AuthController {
  constructor(readonly authService: AuthService) {}

  @Public()
  @ApiOperation({ summary: 'Autenticação de usuário' })
  @ApiResponse({ status: 200, description: 'Usuário logado com sucesso', type: LoginOutput })
  @Post('login')
  async login(@Body() loginDto: LoginInput) {
    return this.authService.login(loginDto.email, loginDto.password);
  }

  @Public()
  @ApiOperation({ summary: 'Recuperação de senha' })
  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }) {
    return this.authService.forgotPassword(body.email);
  }

  @ApiOperation({ summary: 'Reset de senha' })
  @Post('reset-password')
  async resetPassword(@Body() body: { email: string; password: string }) {
    return this.authService.resetPassword(body.email, body.password);
  }
}
