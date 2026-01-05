import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateParameters() {
    console.log('Iniciando migração de parâmetros para todos os tenants...');

    const tenants = await prisma.multitenancy.findMany();

    for (const tenant of tenants) {
        console.log(`Processando tenant: ${tenant.name} (ID: ${tenant.id})`);

        const parameters = [];

        // 1. SIGNATURE_EXPIRATION_HOURS
        let expirationHours = '5';
        if (tenant.id === 1 || tenant.id === 6) {
            expirationHours = '168'; // 7 dias
        }
        parameters.push({ key: 'SIGNATURE_EXPIRATION_HOURS', value: expirationHours, description: 'Tempo de expiração da assinatura em horas' });

        // 2. ROUND_START_DATE_MONTHS
        let roundMonths = '6';
        if (tenant.id === 2) roundMonths = '12';
        if (tenant.id === 5 || tenant.id === 9) roundMonths = '3';
        parameters.push({ key: 'ROUND_START_DATE_MONTHS', value: roundMonths, description: 'Meses para considerar o início de um novo round com cartas ativas' });

        // Upsert de cada parâmetro
        for (const param of parameters) {
            await prisma.parameter.upsert({
                where: {
                    tenantId_key: {
                        tenantId: tenant.id,
                        key: param.key,
                    },
                },
                update: {
                    description: param.description,
                }, // Atualiza a descrição se já existir, mas mantém o valor
                create: {
                    ...param,
                    tenantId: tenant.id,
                },
            });
        }
    }

    console.log('Migração de parâmetros concluída!');
}

migrateParameters()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
