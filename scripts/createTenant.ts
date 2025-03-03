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
            }
        }
    })
})();

