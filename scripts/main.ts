import { Prisma, PrismaClient, multitenancy, type } from '@prisma/client';
import { DefaultArgs } from '@prisma/client/runtime/library';
import xlsx from 'node-xlsx';
import { createTenant, deleteCascateTenant } from './createTenant';
import { createType } from './createType';
import { createTerritory } from './createTerritory';
import { createAddress } from './createAddress';
import { createBlock } from './createBlock';
import { createHouse } from './createHouse';
import { createTerritoryBlock } from './createTerritoryBlock';

export const prisma = new PrismaClient();
export type PrismaTransaction = Omit<
  PrismaClient<Prisma.PrismaClientOptions, never, DefaultArgs>,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
export interface Row {
  TipoTerritorio: string;
  Território: string;
  Quadra: number;
  Logradouro: string;
  Numero: string;
  'Tipo Endereço': string;
  Ordem: number;
  Folha: number;
  Observacao: string;
  'Não Bater': 'VERDADEIRO' | 'FALSO' | null;
}

async function main() {
  try {
    const rows = [] as Row[];
    const [workSheetsFromFile] = xlsx.parse(`scripts/base.xlsx`);
    const headers = workSheetsFromFile.data[0];
    for (let i = 1; i < workSheetsFromFile.data.length; i++) {
      const row = workSheetsFromFile.data[i];
      const rowObject = {} as Row;
      for (let j = 0; j < headers.length; j++) {
        rowObject[headers[j]] = row[j];
      }
      rows.push(rowObject);
    }
    await prisma.$transaction(async txt => {
      const tenant = await createTenant('Central Sorocaba', '15988182683', txt);
      for (const row of rows) {
        await insert(row, txt, tenant);
      }
    });

    console.log('Importação concluída!');
  } catch (error) {
    console.error('Erro ao ler o arquivo CSV:', error);
  } finally {
    prisma.$disconnect(); // Fechar a conexão após a importação
  }
}

async function insert(row: Row, txt: PrismaTransaction, tenant: multitenancy) {
  console.log(`Consultando ou criando o tipo ${row.TipoTerritorio}`);
  const type = await createType(tenant, row, txt);

  const nameTerritory = row['Território'];
  console.log(`Consultando ou criando o território ${nameTerritory}`);
  const territory = await createTerritory(nameTerritory, type, tenant, txt);

  console.log(`Consultando ou criando o endereço ${row.Logradouro}`);
  const address = await createAddress(row, tenant, txt);

  console.log(`Consultando ou criando a quadra ${row.Quadra}`);
  const block = await createBlock(row, tenant, txt);

  console.log(`Consultando ou criando a casa ${row.Numero}`);
  const house = await createHouse(row, territory, address, block, tenant, txt);

  console.log(`Consultando ou criando o território da quadra ${row.Quadra}`);
  await createTerritoryBlock(territory, block, house, tenant, txt);

  console.log(`Casa ${row.Numero} da quadra ${row.Quadra} do território ${nameTerritory} do tipo ${row.TipoTerritorio} importada com sucesso!`);
}

(async () => {
  await main();
  // await deleteCascateTenant(4);
})();
