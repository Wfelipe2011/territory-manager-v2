import { address, block, multitenancy, territory } from '@prisma/client';
import { PrismaTransaction, Row } from './main';

export async function createHouse(row: Row, territory: territory, address: address, block: block, tenant: multitenancy, txt: PrismaTransaction) {
  return await txt.house.create({
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
      dontVisit: row['Não Bater'] === 'VERDADEIRO' ? true : false,
      multitenancy: {
        connect: {
          id: tenant.id,
        },
      },
    },
  });
}
