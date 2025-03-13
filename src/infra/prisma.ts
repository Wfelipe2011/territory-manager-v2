import { Prisma, PrismaClient } from '@prisma/client';
import { DefaultArgs } from '@prisma/client/runtime/library';
const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

export { prisma };

export type PrismaTransaction = Omit<PrismaClient<Prisma.PrismaClientOptions, never, DefaultArgs>, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">