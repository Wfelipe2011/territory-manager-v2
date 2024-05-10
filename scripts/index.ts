import { PrismaClient } from '@prisma/client';
import xlsx from 'node-xlsx';

const prisma = new PrismaClient();
const tenantId = 3;

interface Row {
  TipoTerritorio: string;
  Território: string;
  Quadra: number;
  Logradouro: string;
  Numero: string;
  'Tipo Endereço': string;
  Ordem: number;
  Folha: number;
  Observacao: string;
  'Não Bater': 'Sim' | 'Não' | null;
}

async function importData() {
  try {
    const rows = [] as Row[];
    const [workSheetsFromFile] = xlsx.parse(`scripts/TERRITORIO.xlsx`);
    const headers = workSheetsFromFile.data[0];
    for (let i = 1; i < workSheetsFromFile.data.length; i++) {
      const row = workSheetsFromFile.data[i];
      const rowObject = {} as Row;
      for (let j = 0; j < headers.length; j++) {
        rowObject[headers[j]] = row[j];
      }
      rows.push(rowObject);
    }

    for (const row of rows) {
      try {
        // Salvar os dados do CSV usando Prisma
        await insert(row);
        console.log('Importado com sucesso!');
      } catch (error) {
        console.error('Erro ao importar os dados:', error);
      }
    }

    console.log('Importação concluída!');
  } catch (error) {
    console.error('Erro ao ler o arquivo CSV:', error);
  } finally {
    prisma.$disconnect(); // Fechar a conexão após a importação
  }
}

(async () => {
  await importData();
})();

async function insert(row: Row) {
  try {
    console.log(`Consultando ou criando o tipo ${row.TipoTerritorio}`);
    const type = await createType(row);

    const nameTerritory = row['Território'];
    console.log(`Consultando ou criando o território ${nameTerritory}`);
    const territory = await createTerritory(nameTerritory, type);

    console.log(`Consultando ou criando o endereço ${row.Logradouro}`);
    const address = await createAddress(row);

    console.log(`Consultando ou criando a quadra ${row.Quadra}`);
    const block = await createBlock(row);

    console.log(`Consultando ou criando a casa ${row.Numero}`);
    const house = await createHouse(row, territory, address, block);

    console.log(`Consultando ou criando o território da quadra ${row.Quadra}`);
    await createTerritoryBlock(territory, block, house);

    console.log(`Casa ${row.Numero} da quadra ${row.Quadra} do território ${nameTerritory} do tipo ${row.TipoTerritorio} importada com sucesso!`);
  } catch (error) {
    console.error('Erro ao importar os dados:', error);
  }
}

async function createTerritoryBlock(
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
  let territoryBlock = await prisma.territory_block.findUnique({
    where: {
      territoryId_blockId: {
        territoryId: territory.id,
        blockId: block.id,
      },
    },
  });
  if (!territoryBlock) {
    territoryBlock = await prisma.territory_block.create({
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
            id: tenantId,
          },
        },
      },
    });
  }
}

async function createHouse(
  row: Row,
  territory: { id: number; name: string; tenantId: number; typeId: number; imageUrl: string | null },
  address: { id: number; name: string; tenantId: number },
  block: { id: number; name: string; tenantId: number }
) {
  return await prisma.house.create({
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
      legend: row['Tipo Endereço'],
      block: {
        connect: {
          id: block.id,
        },
      },
      order: Number(row.Ordem),
      dontVisit: row['Não Bater'] === 'Sim' ? true : false,
      multitenancy: {
        connect: {
          id: tenantId,
        },
      },
    },
  });
}

async function createBlock(row: Row) {
  let block = await prisma.block.findFirst({
    where: {
      name: 'Quadra ' + row.Quadra,
      tenantId: tenantId,
    },
  });
  if (!block) {
    block = await prisma.block.create({
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

async function createAddress(row: Row) {
  let address = await prisma.address.findFirst({
    where: {
      name: row.Logradouro,
      tenantId: tenantId,
    },
  });
  if (!address) {
    address = await prisma.address.create({
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

async function createTerritory(nameTerritory: string, type: { id: number; name: string; tenantId: number }) {
  let territory = await prisma.territory.findFirst({
    where: {
      name: nameTerritory,
      typeId: type.id,
      tenantId: tenantId,
    },
  });
  if (!territory) {
    territory = await prisma.territory.create({
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

async function createType(row: Row) {
  let type = await prisma.type.findFirst({
    where: {
      name: row.TipoTerritorio,
      tenantId: tenantId,
    },
  });
  if (!type) {
    type = await prisma.type.create({
      data: {
        name: row.TipoTerritorio,
        tenantId: tenantId,
      },
    });
  }
  return type;
}
