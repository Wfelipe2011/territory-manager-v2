import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import xlsx from 'node-xlsx';
import EventEmitter from 'events';
import { UploadGateway } from '../gateway/upload.gateway';
import { BulkImportRow, ImportReport } from './contracts/BulkImportInput';
import { LegengDTO } from '../house/dtos/Legend';

export interface Row {
  TipoTerritorio: string;
  Território: string;
  Quadra: string | number;
  Logradouro: string;
  Numero: string;
  Legenda: string;
  Ordem: number;
  'Não Bater': 'VERDADEIRO' | 'FALSO' | null;
}

@Injectable()
export class UploadTerritoryUseCase {
  private readonly logger = new Logger(UploadTerritoryUseCase.name);
  private eventEmitter: EventEmitter;
  constructor(
    readonly prisma: PrismaService,
    private readonly uploadGateway: UploadGateway
  ) {
    this.eventEmitter = new EventEmitter();
  }

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

    const bulkRows: BulkImportRow[] = rows.map(row => ({
      TipoTerritorio: row.TipoTerritorio,
      Território: row.Território,
      Quadra: String(row.Quadra),
      Logradouro: row.Logradouro,
      Numero: row.Numero,
      Legenda: row.Legenda,
      Ordem: row.Ordem,
      'Não Bater': row['Não Bater'] === 'VERDADEIRO'
    }));

    return this.bulkInsert(bulkRows, body.tenantId, body.userId, logger);
  }

  async bulkInsert(
    rows: BulkImportRow[],
    tenantId: number,
    userId: number,
    logger: Logger
  ): Promise<ImportReport> {
    const report: ImportReport = {
      totalProcessed: rows.length,
      successCount: 0,
      errorCount: 0,
      errors: [],
    };

    let porcentagem = 0;
    for (const [i, row] of rows.entries()) {
      try {
        await this.insert(row, tenantId, logger);
        report.successCount++;
      } catch (error) {
        report.errorCount++;
        report.errors.push({
          index: i,
          row,
          error: error.message || 'Erro desconhecido',
        });
        logger.error(`Erro na linha ${i}:`, error);
      }

      const progress = Math.round(((i + 1) / rows.length) * 100);
      if (progress > porcentagem) {
        porcentagem = progress;
        this.uploadGateway.sendProgress(userId, progress);
      }
    }

    await this.populateTerritoryAddress(tenantId);

    return report;
  }

  async insert(row: BulkImportRow, tenantId: number, logger: Logger) {
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
    row: BulkImportRow,
    territory: { id: number; name: string; tenantId: number; typeId: number; imageUrl: string | null },
    address: { id: number; name: string; tenantId: number },
    block: { id: number; name: string; tenantId: number }
  ) {
    return await this.prisma.house.create({
      data: {
        number: String(row.Numero),
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
        legend: LegengDTO.mapper(row.Legenda || 'Residência'),
        observations: '',
        block: {
          connect: {
            id: block.id,
          },
        },
        order: row.Ordem ? Number(row.Ordem) : null,
        dontVisit: !!row['Não Bater'],
        multitenancy: {
          connect: {
            id: territory.tenantId,
          },
        },
      },
    });
  }

  async createBlock(row: BulkImportRow, tenantId: number) {
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

  async createAddress(row: BulkImportRow, tenantId: number) {
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
        name: String(nameTerritory),
        typeId: type.id,
        tenantId: tenantId,
      },
    });
    if (!territory) {
      territory = await this.prisma.territory.create({
        data: {
          name: String(nameTerritory),
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

  async createType(row: BulkImportRow, tenantId: number) {
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
    const abas = xlsx.parse(file.buffer);
    for (const aba of abas) {
      const headers = aba.data[0];
      for (let i = 1; i < aba.data.length; i++) {
        const row = aba.data[i];
        const rowObject = {} as any;
        for (let j = 0; j < headers.length; j++) {
          rowObject[headers[j]] = row[j];
        }
        rows.push(rowObject);
      }
    }
    return rows;
  }

  async populateTerritoryAddress(tenantId: number) {
    const distinctHouses = await this.prisma.house.findMany({
      distinct: ['territoryId', 'blockId', 'addressId', 'tenantId'],
      select: {
        territoryId: true,
        blockId: true,
        addressId: true,
        tenantId: true
      },
      where: {
        tenantId
      }
    });

    for (const house of distinctHouses) {
      await this.prisma.$transaction(async (tsx) => {
        this.logger.debug(`Processando casa: territory=${house.territoryId} block=${house.blockId} address=${house.addressId}`);
        const territoryBlock = await tsx.territory_block.findUnique({
          where: {
            territoryId_blockId: {
              territoryId: house.territoryId,
              blockId: house.blockId
            }
          }
        });

        if (!territoryBlock) {
          return true;
        }

        const territoryAddress = await tsx.territory_block_address.create({
          data: {
            addressId: house.addressId,
            tenantId: house.tenantId,
            territoryBlockId: territoryBlock.id
          }
        });
        await tsx.house.updateMany({
          where: {
            territoryId: house.territoryId,
            blockId: house.blockId,
            addressId: house.addressId,
            tenantId: house.tenantId
          },
          data: {
            territoryBlockAddressId: territoryAddress.id
          }
        });
        this.logger.debug(`Territory address criado: ${territoryAddress.id}`);
        return true;
      }, {
        maxWait: 1000 * 60 * 10, // 10 minutes,
        timeout: 1000 * 60 * 10 // 10 minutes
      }).catch((err) => {
        this.logger.error('Erro ao processar territory address', err);
      });
    }
    this.logger.log('Endereços de território populados com sucesso');
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
