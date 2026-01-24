import { Body, Controller, Get, Post, Render, Request, Param, Delete, Put, Query } from '@nestjs/common';
import { FinancialService } from './financial.service';
import { RequestUser } from 'src/interfaces/RequestUser';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enum/role.enum';
import { FinancialEntryType } from '@prisma/client';
import { VERSION } from 'src/enum/version.enum';

@Controller({
    version: VERSION.V1,
    path: 'financial',
})
export class FinancialController {
    constructor(private readonly financialService: FinancialService) { }

    @Get()
    @Render('financial')
    async financialPage(@Request() req: RequestUser) {
        const isSuperAdmin = req.user.roles.includes(Role.SUPER_ADMIN);

        // Conforme o PRD, a tabela reflete o tenant selecionado (contexto atual)
        const tenantId = req.user.tenantId;
        const entries = await this.financialService.findAll(tenantId);

        // O resumo consolidado (Global) é exibido apenas para o Super Admin.
        // Para outros, o resumo é do próprio tenant.
        const summary = await this.financialService.getSummary(isSuperAdmin ? undefined : tenantId);

        const tenants = await this.financialService.getTenants();

        return {
            entries,
            summary,
            tenants,
            user: req.user,
            isSuperAdmin,
            activePage: 'financial',
        };
    }

    @Get('entries/:id')
    async getEntry(@Param('id') id: string) {
        return this.financialService.findOne(+id);
    }

    @Post('entries')
    async createEntry(@Body() body: any, @Request() req: RequestUser) {
        return this.financialService.create({
            tenantId: req.user.tenantId,
            value: parseFloat(body.value),
            date: new Date(body.date),
            description: body.description,
            type: body.type as FinancialEntryType,
            donorName: body.donorName,
        });
    }

    @Put('entries/:id')
    async updateEntry(@Param('id') id: string, @Body() body: any) {
        return this.financialService.update(+id, {
            value: body.value ? parseFloat(body.value) : undefined,
            date: body.date ? new Date(body.date) : undefined,
            description: body.description,
            type: body.type as FinancialEntryType,
            donorName: body.donorName,
        });
    }

    @Delete('entries/:id')
    async removeEntry(@Param('id') id: string) {
        return this.financialService.remove(+id);
    }
}
