import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma.service';
import xlsx from 'node-xlsx';
import EventEmitter from 'events';
import { UploadGateway } from '../gateway/upload.gateway';

export interface Row {
  TipoTerritorio: string;
  Território: string;
  Quadra: number;
  Logradouro: string;
  Numero: string;
  Legenda: string;
  Ordem: number;
  'Não Bater': 'VERDADEIRO' | 'FALSO' | null;
}

@Injectable()
export class UploadTerritoryUseCase {
  private eventEmitter: EventEmitter;
  constructor(
    readonly prisma: PrismaService,
    readonly uploadGateway: UploadGateway
  ) {}

  onProgress(callback: (progress: number) => void) {
    this.eventEmitter.on('progress', callback);
  }

  async execute(
    body: {
      file: Express.Multer.File;
      tenantId: number;
      userId: number;
    },
    logger: Logger
  ) {
    logger.log(`Usuário do tenant ${body.tenantId} está fazendo upload de um arquivo`);
    const rows = this.getDataRows(body.file).filter(row => row['Território']);
    let porcentagem = 0;
    for (const [i, row] of rows.entries()) {
      const totalRows = rows.length;
      await this.insert(row, body.tenantId, logger);
      const progress = Math.round(((i + 1) / totalRows) * 100);
      if (progress > porcentagem) {
        porcentagem = progress;
        this.uploadGateway.sendProgress(body.userId, progress);
      }
    }

    return rows;
  }

  async insert(row: Row, tenantId: number, logger: Logger) {
    try {
      logger.log(`Consultando ou criando o tipo ${row.TipoTerritorio}`);
      const type = await this.createType(row, tenantId);

      const nameTerritory = row['Território'];
      logger.log(`Consultando ou criando o território ${nameTerritory}`);
      const territory = await this.createTerritory(nameTerritory, type, tenantId);

      logger.log(`Consultando ou criando o endereço ${row.Logradouro}`);
      const address = await this.createAddress(row, tenantId);

      logger.log(`Consultando ou criando a quadra ${row.Quadra}`);
      const block = await this.createBlock(row, tenantId);

      logger.log(`Consultando ou criando a casa ${row.Numero}`);
      const house = await this.createHouse(row, territory, address, block);

      logger.log(`Consultando ou criando o território da quadra ${row.Quadra}`);
      await this.createTerritoryBlock(territory, block, house);

      logger.log(`Casa ${row.Numero} da quadra ${row.Quadra} do território ${nameTerritory} do tipo ${row.TipoTerritorio} importada com sucesso!`);
    } catch (error) {
      logger.error('Erro ao importar os dados:', error);
    }
  }

  async createTerritoryBlock(
    territory: { id: number; name: string; tenantId: number; typeId: number; imageUrl: string | null },
    block: { id: number; name: string; tenantId: number },
    house: {
      id: number;
      number: string;
      complement: string | null;
      legend: string | null;
      order: number | null;
      dontVisit: boolean;
      observations: string | null;
      blockId: number;
      addressId: number;
      phone: string | null;
      territoryId: number;
      tenantId: number;
    }
  ) {
    let territoryBlock = await this.prisma.territory_block.findUnique({
      where: {
        territoryId_blockId: {
          territoryId: territory.id,
          blockId: block.id,
        },
      },
    });
    if (!territoryBlock) {
      territoryBlock = await this.prisma.territory_block.create({
        data: {
          territory: {
            connect: {
              id: territory.id,
            },
          },
          block: {
            connect: {
              id: house.blockId,
            },
          },
          multitenancy: {
            connect: {
              id: territory.tenantId,
            },
          },
        },
      });
    }
  }

  async createHouse(
    row: Row,
    territory: { id: number; name: string; tenantId: number; typeId: number; imageUrl: string | null },
    address: { id: number; name: string; tenantId: number },
    block: { id: number; name: string; tenantId: number }
  ) {
    return await this.prisma.house.create({
      data: {
        number: String(row.Numero) + '-' + row.Ordem,
        territory: {
          connect: {
            id: territory.id,
          },
        },
        address: {
          connect: {
            id: address.id,
          },
        },
        legend: 'Residência',
        observations: row['Legenda'],
        block: {
          connect: {
            id: block.id,
          },
        },
        order: Number(row.Ordem),
        dontVisit: row['Não Bater'] == 'FALSO' ? false : true,
        multitenancy: {
          connect: {
            id: territory.tenantId,
          },
        },
      },
    });
  }

  async createBlock(row: Row, tenantId: number) {
    let block = await this.prisma.block.findFirst({
      where: {
        name: 'Quadra ' + row.Quadra,
        tenantId: tenantId,
      },
    });
    if (!block) {
      block = await this.prisma.block.create({
        data: {
          name: 'Quadra ' + row.Quadra,
          multitenancy: {
            connect: {
              id: tenantId,
            },
          },
        },
      });
    }
    return block;
  }

  async createAddress(row: Row, tenantId: number) {
    let address = await this.prisma.address.findFirst({
      where: {
        name: row.Logradouro,
        tenantId: tenantId,
      },
    });
    if (!address) {
      address = await this.prisma.address.create({
        data: {
          name: row.Logradouro,
          multitenancy: {
            connect: {
              id: tenantId,
            },
          },
        },
      });
    }
    return address;
  }

  async createTerritory(nameTerritory: string, type: { id: number; name: string; tenantId: number }, tenantId: number) {
    let territory = await this.prisma.territory.findFirst({
      where: {
        name: nameTerritory,
        typeId: type.id,
        tenantId: tenantId,
      },
    });
    if (!territory) {
      territory = await this.prisma.territory.create({
        data: {
          name: nameTerritory,
          multitenancy: {
            connect: {
              id: tenantId,
            },
          },
          type: {
            connect: {
              id: type.id,
            },
          },
        },
      });
    }
    return territory;
  }

  async createType(row: Row, tenantId: number) {
    let type = await this.prisma.type.findFirst({
      where: {
        name: row.TipoTerritorio,
        tenantId: tenantId,
      },
    });
    if (!type) {
      type = await this.prisma.type.create({
        data: {
          name: row.TipoTerritorio,
          tenantId: tenantId,
        },
      });
    }
    return type;
  }

  private getDataRows(file: Express.Multer.File) {
    const rows = [] as Row[];
    const [workSheetsFromFile] = xlsx.parse(file.buffer);
    const headers = workSheetsFromFile.data[0];
    for (let i = 1; i < workSheetsFromFile.data.length; i++) {
      const row = workSheetsFromFile.data[i];
      const rowObject = {} as any;
      for (let j = 0; j < headers.length; j++) {
        rowObject[headers[j]] = row[j];
      }
      rows.push(rowObject);
    }
    return rows;
  }

  // vamos limpar o tenantId
  private async deleteTenant(tenantId: number) {
    await this.prisma.round.deleteMany({
      where: {
        tenantId,
      },
    });

    await this.prisma.house.deleteMany({
      where: {
        tenantId,
      },
    });

    await this.prisma.address.deleteMany({
      where: {
        tenantId,
      },
    });

    await this.prisma.territory_block.deleteMany({
      where: {
        tenantId,
      },
    });

    await this.prisma.territory_overseer.deleteMany({
      where: {
        tenantId,
      },
    });

    await this.prisma.territory.deleteMany({
      where: {
        tenantId,
      },
    });

    await this.prisma.type.deleteMany({
      where: {
        tenantId,
      },
    });
  }
}
