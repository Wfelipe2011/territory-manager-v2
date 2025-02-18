import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma/prisma.service';

@Injectable()
export class AddressService {
  private logger = new Logger(AddressService.name);
  constructor(readonly prisma: PrismaService) { }

  async findAll(territoryId: number) {
    const territory = await this.prisma.territory.findUnique({
      where: {
        id: territoryId,
      },
    });
    if (!territory) throw new NotFoundException('Território não encontrado');

    const addresses = await this.prisma.$queryRaw<{ id: number; name: string }[]>`
      select a.id, a."name"  from address a 
      inner join house h on h.address_id = a.id and h.territory_id = ${territoryId}
      group by a.id, a."name"
      order by a."name"
    `;
    return addresses;
  }
}
