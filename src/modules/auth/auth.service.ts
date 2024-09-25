import { BadRequestException, Injectable, InternalServerErrorException, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma.service';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { uuid } from 'src/shared/uuid.shared';
import { envs } from 'src/infra/envs';
import nodemailer from 'nodemailer';

@Injectable()
export class AuthService {
  logger = new Logger(AuthService.name);
  constructor(private prisma: PrismaService) {}

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
        id: user.id,
      },
      envs.JWT_SECRET,
      {
        expiresIn: '30m',
      }
    );
    const info = await transporte
      .sendMail({
        from: process.env.NODEMAILER_USER,
        to: email,
        subject: 'Recuperação de senha',
        text: 'Recuperação de senha',
        html: getHTML(token),
      })
      .catch(err => {
        this.logger.error(err);
        throw new InternalServerErrorException('Erro ao enviar email');
      });

    this.logger.log(`Email enviado para ${email}`);
    this.logger.log(info);
    return { message: 'Email enviado' };
  }

  async resetPassword(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        email,
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

    this.logger.log(`Gerando token ${user?.email}`);
    const token = jwt.sign(
      {
        id: uuid(),
        userId: user.id,
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

  private createTransporter() {
    return nodemailer.createTransport({
      service: 'gmail',
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.NODEMAILER_USER,
        pass: process.env.NODEMAILER_APP_PASS,
      },
    });
  }
}

function getHTML(token: string) {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Recuperação de Senha</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 0;
        }
        .container {
            max-width: 600px;
            margin: 50px auto;
            padding: 20px;
            background-color: #fff;
            border-radius: 8px;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
        }
        h1 {
            text-align: center;
            color: #333;
        }
        p {
            margin-bottom: 20px;
            line-height: 1.6;
            color: #666;
        }
        .btn {
            display: inline-block;
            padding: 10px 20px;
            background-color: #007bff;
            color: #fff !important;
            text-decoration: none;
            border-radius: 5px;
            transition: background-color 0.3s ease;
        }
        .btn:hover {
            background-color: #0056b3;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Recuperação de Senha</h1>
        <p>Olá! Você solicitou a recuperação de senha. Clique no botão abaixo para criar uma nova senha:</p>
        <p><a href="https://app.territory-manager.com.br/reset-password?token=${token}" class="btn">Clique aqui para recuperar sua senha</a></p>
        <p>Se você não solicitou essa recuperação, por favor, ignore este email.</p>
    </div>
</body>
</html>
  `;
}
