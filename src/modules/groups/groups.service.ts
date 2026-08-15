import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/infra/prisma/prisma.service';

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: number) {
    return this.prisma.group.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, createdAt: true },
    });
  }

  async create(name: string, tenantId: number) {
    try {
      return await this.prisma.group.create({
        data: { name, tenantId },
        select: { id: true, name: true, createdAt: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Já existe um grupo com esse nome neste tenant');
      }
      throw error;
    }
  }

  async update(id: string, name: string, tenantId: number) {
    const group = await this.prisma.group.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!group) throw new NotFoundException('Grupo não encontrado');

    try {
      return await this.prisma.group.update({
        where: { id: group.id },
        data: { name },
        select: { id: true, name: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Já existe um grupo com esse nome neste tenant');
      }
      throw error;
    }
  }

  async remove(id: string, tenantId: number): Promise<{ deleted: boolean }> {
    const group = await this.prisma.group.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!group) throw new NotFoundException('Grupo não encontrado');

    await this.prisma.$transaction(async tx => {
      await tx.waitingRoomPresence.deleteMany({
        where: { groupId: group.id, tenantId },
      });
      await tx.assignment.deleteMany({
        where: { groupId: group.id, tenantId },
      });
      await tx.group.delete({
        where: { id: group.id },
      });
    });
    this.logger.log(`Grupo ${id} removido (presenças e atribuições limpas)`);
    return { deleted: true };
  }
}
