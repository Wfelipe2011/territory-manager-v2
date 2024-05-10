import { Logger, MethodNotAllowedException, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma.service';

export class SignatureIsValid {
  logger = new Logger(SignatureIsValid.name);
  constructor(private readonly prisma: PrismaService) {}
  async execute(signatureId: string): Promise<void> {
    this.logger.log('Validando assinatura');
    const signature = await this.prisma.signature.findUnique({
      where: { key: signatureId },
    });
    if (!signature?.expirationDate) throw new NotFoundException('Assinatura inválida');
    if (signature.expirationDate.getTime() < new Date().getTime()) throw new MethodNotAllowedException('Assinatura expirada');
    this.logger.log('Assinatura válida');
  }
}
