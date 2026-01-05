import { PrismaClient } from '@prisma/client';
import { v4 as uuid } from 'uuid';
const prisma = new PrismaClient();

(async () => {
    await prisma.$connect()

    const tenant = {
        name: "Central Lorena",
        phone: "12981829844",
    }

    const user = {
        name: "Central Lorena",
        email: "joaowictor756@gmail.com",
        password: "$2b$10$wgySAFayJt4bIjhGCBVCxehxvW7Yk.TOxsZaEiBb9R8f5egKg73kq",
    }

    const types = [
        { name: 'Residencial' },
        { name: 'Rural' },
    ]

    const defaults = [
        { key: 'SIGNATURE_EXPIRATION_HOURS', value: '5', description: 'Tempo de expiração da assinatura em horas' },
        { key: 'ROUND_START_DATE_MONTHS', value: '6', description: 'Meses para considerar o início de um novo round com cartas ativas' }
    ];

    await prisma.multitenancy.create({
        data: {
            ...tenant,
            users: {
                create: {
                    name: user.name,
                    email: user.email,
                    password: user.password
                }
            },
            type: {
                createMany: {
                    data: types
                }
            },
            parameters: {
                createMany: {
                    data: defaults
                }
            }
        }
    })
})();

