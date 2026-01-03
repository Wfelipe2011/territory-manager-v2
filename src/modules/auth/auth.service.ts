import { BadRequestException, Injectable, InternalServerErrorException, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { uuid } from 'src/shared/uuid.shared';
import { envs } from 'src/infra/envs';
import nodemailer from 'nodemailer';
import { AdminRegisterInput, PublicRegisterInput, UserOutput } from './contracts';

@Injectable()
export class AuthService {
  logger = new Logger(AuthService.name);
  constructor(private prisma: PrismaService) { }

  async login(email: string, password: string) {
    this.logger.log(`login ${email}`);
    if (!email || !password) throw new BadRequestException('Faltando dados');
    const user = await this.prisma.user.findUnique({
      where: {
        email,
      },
    });
    this.logger.log(`Verificando usuário ${user?.email}`);
    if (!user) throw new UnauthorizedException('Não autorizado');
    this.logger.log(`Verificando senha ${user?.email}`);
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) throw new UnauthorizedException('Não autorizado');
    this.logger.log(`Gerando token ${user?.email}`);
    const token = jwt.sign(
      {
        id: uuid(),
        userId: user.id,
        userName: user.name,
        roles: ['admin'],
        tenantId: user.tenantId,
      },
      envs.JWT_SECRET,
      {
        expiresIn: '1d',
      }
    );

    return { token };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        email,
      },
    });
    if (!user) throw new BadRequestException('Usuário não encontrado');
    const transporte = this.createTransporter();
    const token = jwt.sign(
      {
        email: user.email,
        purpose: 'password-recovery',
      },
      envs.JWT_SECRET,
      {
        expiresIn: '30m',
      }
    );
    const info = await transporte
      .sendMail({
        from: '"Território Digital" <atendimento@territory-manager.com.br>',
        to: email,
        subject: 'Recuperação de senha – Território Digital',
        text: getText(token),
        html: getHTML(token),
        headers: {
          'Content-Language': 'pt-BR',
        },
      })
      .catch(err => {
        this.logger.error(err);
        throw new InternalServerErrorException('Erro ao enviar email');
      });

    this.logger.log(`Email enviado para ${email}`);
    this.logger.log(info);
    return { message: 'Email enviado' };
  }

  async resetPassword(token: string, password: string) {
    try {
      const payload = jwt.verify(token, envs.JWT_SECRET) as { email: string; purpose: string };
      if (payload.purpose !== 'password-recovery') {
        throw new UnauthorizedException('Token inválido para esta operação');
      }

      const user = await this.prisma.user.findUnique({
        where: {
          email: payload.email,
        },
      });

      if (!user) throw new BadRequestException('Usuário não encontrado');
      const newPassword = await bcrypt.hash(password, 10);
      await this.prisma.user.update({
        where: {
          id: user.id,
        },
        data: {
          password: newPassword,
        },
      });

      return { message: 'Senha alterada com sucesso' };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new BadRequestException('Token expirado');
      }
      throw new UnauthorizedException('Token inválido');
    }
  }

  async adminRegister(input: AdminRegisterInput, tenantId: number) {
    const userExists = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });

    if (userExists) {
      throw new BadRequestException('Email já está em uso');
    }

    const temporaryPassword = Math.random().toString(36).slice(-10);
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);

    const user = await this.prisma.user.create({
      data: {
        name: input.name,
        email: input.email.toLowerCase(),
        password: hashedPassword,
        tenantId,
      },
    });

    await this.sendWelcomeEmail(user.email);

    return { message: 'Administrador registrado com sucesso' };
  }

  async listUsers(tenantId: number): Promise<UserOutput[]> {
    return this.prisma.user.findMany({
      where: {
        tenantId,
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });
  }

  async publicRegister(input: PublicRegisterInput) {
    const userExists = await this.prisma.user.findUnique({
      where: { email: input.userEmail.toLowerCase() },
    });

    if (userExists) {
      throw new BadRequestException('Email já está em uso');
    }

    const tenant = await this.prisma.multitenancy.create({
      data: {
        name: input.tenantName,
        phone: input.tenantPhone,
      },
    });

    const temporaryPassword = Math.random().toString(36).slice(-10);
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);

    await this.prisma.user.create({
      data: {
        name: input.userName,
        email: input.userEmail.toLowerCase(),
        password: hashedPassword,
        tenantId: tenant.id,
      },
    });

    await this.sendWelcomeEmail(input.userEmail.toLowerCase());

    return { message: 'Usuário e organização registrados com sucesso' };
  }

  private async sendWelcomeEmail(email: string) {
    const token = jwt.sign(
      {
        email,
        purpose: 'password-recovery',
      },
      envs.JWT_SECRET,
      {
        expiresIn: '24h',
      }
    );

    const transporte = this.createTransporter();

    await transporte
      .sendMail({
        from: '"Território Digital" <atendimento@territory-manager.com.br>',
        to: email,
        subject: 'Bem-vindo ao Território Digital',
        text: getWelcomeText(token),
        html: getWelcomeHTML(token),
        headers: {
          'Content-Language': 'pt-BR',
        },
      })
      .catch(err => {
        this.logger.error(err);
        throw new InternalServerErrorException('Erro ao enviar email de boas-vindas');
      });

    this.logger.log(`Email de boas-vindas enviado para ${email}`);
  }

  hashPassword(password: string) {
    return {
      password: bcrypt.hashSync(password, 10),
    }
  }

  private createTransporter() {
    return nodemailer.createTransport({
      service: 'umbler',
      host: 'smtp.umbler.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.NODEMAILER_USER,
        pass: process.env.NODEMAILER_APP_PASS,
      },
      tls: {
        rejectUnauthorized: false, // evita problemas com certificados
      },
    });
  }
}

function getText(token: string) {
  return `
Recuperação de senha – Território Digital

Recebemos uma solicitação para redefinir a senha da sua conta.

Para criar uma nova senha, acesse o link abaixo:
https://admin.territory-manager.com.br/reset-password?token=${token}

Se você não solicitou esta alteração, ignore este e-mail.
`;
}

function getHTML(token: string) {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Language" content="pt-BR">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Recuperação de Senha - Território Digital</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #f0f2f5;
            margin: 0;
            padding: 0;
            -webkit-font-smoothing: antialiased;
        }
        .wrapper {
            width: 100%;
            table-layout: fixed;
           background-color: #f0f2f5;
            padding-bottom: 40px;
        }
        .container {
            max-width: 600px;
            background-color: #f0f2f5;
            margin: 0 auto;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        }
        .header {
            background-color: #f0f2f5;
            padding: 40px 20px;
            text-align: center;
        }
        .logo {
            background-color: #7AAD58;
            padding: 5px;
            border-radius: 100%;
            width: 200px;
            height: auto;
        }
        .content {
            padding: 0 40px 40px 40px;
            text-align: center;
            color: #333333;
        }
        h1 {
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 16px;
            color: #1a1a1a;
        }
        p {
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 32px;
            color: #666666;
        }
        .btn-container {
            margin-bottom: 32px;
        }
        .btn {
            display: inline-block;
            padding: 14px 32px;
            background-color: #7AAD58;
            color: #ffffff !important;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            transition: background-color 0.3s ease;
        }
        .footer {
            padding: 20px;
            text-align: center;
            font-size: 12px;
            color: #999999;
        }
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="header">
            <img src="https://admin.territory-manager.com.br/_next/image?url=%2Flogo.png&w=1080&q=75" alt="Território Digital" class="logo">
        </div>
        <div class="container">
            <div class="content">
                <h1>Recuperação de Senha</h1>
                <p>Olá! Recebemos uma solicitação para redefinir a senha da sua conta no <strong>Território Digital</strong>.</p>
                <p>Para prosseguir com a alteração, clique no botão abaixo:</p>
                <div class="btn-container">
                    <a href="https://admin.territory-manager.com.br/reset-password?token=${token}" class="btn">REDEFINIR MINHA SENHA</a>
                </div>
                <p style="font-size: 14px; margin-bottom: 0;">Se você não solicitou esta alteração, pode ignorar este e-mail com segurança. Sua senha atual permanecerá a mesma.</p>
            </div>
        </div>
        <div class="footer">
            &copy; ${new Date().getFullYear()} Território Digital. Todos os direitos reservados.
        </div>
    </div>
</body>
</html>
  `;
}

function getWelcomeText(token: string) {
  return `
Bem-vindo ao Território Digital!

Sua conta foi criada com sucesso. Para começar a utilizar o sistema, você precisa definir sua senha.

Acesse o link abaixo para criar sua senha:
https://admin.territory-manager.com.br/reset-password?token=${token}

Este link é válido por 24 horas.
`;
}

function getWelcomeHTML(token: string) {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Language" content="pt-BR">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bem-vindo ao Território Digital</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #f0f2f5;
            margin: 0;
            padding: 0;
            -webkit-font-smoothing: antialiased;
        }
        .wrapper {
            width: 100%;
            table-layout: fixed;
           background-color: #f0f2f5;
            padding-bottom: 40px;
        }
        .container {
            max-width: 600px;
            background-color: #f0f2f5;
            margin: 0 auto;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        }
        .header {
            background-color: #f0f2f5;
            padding: 40px 20px;
            text-align: center;
        }
        .logo {
            background-color: #7AAD58;
            padding: 5px;
            border-radius: 100%;
            width: 200px;
            height: auto;
        }
        .content {
            padding: 0 40px 40px 40px;
            text-align: center;
            color: #333333;
        }
        h1 {
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 16px;
            color: #1a1a1a;
        }
        p {
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 32px;
            color: #666666;
        }
        .btn-container {
            margin-bottom: 32px;
        }
        .btn {
            display: inline-block;
            padding: 14px 32px;
            background-color: #7AAD58;
            color: #ffffff !important;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            transition: background-color 0.3s ease;
        }
        .footer {
            padding: 20px;
            text-align: center;
            font-size: 12px;
            color: #999999;
        }
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="header">
            <img src="https://admin.territory-manager.com.br/_next/image?url=%2Flogo.png&w=1080&q=75" alt="Território Digital" class="logo">
        </div>
        <div class="container">
            <div class="content">
                <h1>Bem-vindo ao Território Digital!</h1>
                <p>Olá! Sua conta foi criada com sucesso no <strong>Território Digital</strong>.</p>
                <p>Para começar a utilizar o sistema e gerenciar seus territórios, você precisa definir sua senha de acesso clicando no botão abaixo:</p>
                <div class="btn-container">
                    <a href="https://admin.territory-manager.com.br/reset-password?token=${token}" class="btn">DEFINIR MINHA SENHA</a>
                </div>
                <p style="font-size: 14px; margin-bottom: 0;">Este link é válido por 24 horas. Se você não esperava este e-mail, pode ignorá-lo.</p>
            </div>
        </div>
        <div class="footer">
            &copy; ${new Date().getFullYear()} Território Digital. Todos os direitos reservados.
        </div>
    </div>
</body>
</html>
  `;
}
