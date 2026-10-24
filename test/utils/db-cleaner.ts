import { PrismaClient } from '@prisma/client';

export const cleanDatabase = async (prisma: PrismaClient) => {
    if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== '/territory_manager_test') throw new Error('Limpeza permitida somente no banco territory_manager_test');
    const tablenames = await prisma.$queryRaw<
        Array<{ tablename: string }>
    >`SELECT tablename FROM pg_tables WHERE schemaname='public'`;

    const tables = tablenames
        .map(({ tablename }) => tablename)
        .filter((name) => name !== '_prisma_migrations')
        .map((name) => `"public"."${name}"`)
        .join(', ');

    try {
        if (tables) {
            await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`);
        }
    } catch (error) {
        console.log({ error });
    }
};
