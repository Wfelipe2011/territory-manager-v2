import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const tenantId = 1;
const City = 'Sorocaba';
const State = 'SP';

(async () => {
    await prisma.$connect();
    //  https://viacep.com.br/ws/SP/Sao%20Paulo/Avenida%20Paulista/json/ -> buscar cep para popular os endereços do banco de dados
    const addresses = await prisma.address.findMany({
        where: {
            tenantId
        }
    });

    for (const address of addresses) {
        try {
            const url = `https://viacep.com.br/ws/${State}/${City}/${address.name}/json/`;
            console.log(`Searching for ${address.name} address in ${City} - ${State}`);
            const response = await fetch(url);
            const [data] = await response.json();
            if (!data) continue;
            console.log(`Found ${data.logradouro} - ${data.cep}`);
            await prisma.address.update({
                where: {
                    id: address.id
                },
                data: {
                    zipCode: data.cep,
                    name: data.logradouro
                }
            });
            await new Promise((resolve) => setTimeout(resolve, 5000));
        } catch (error) {
            console.error(error);
        }
    }

})();

