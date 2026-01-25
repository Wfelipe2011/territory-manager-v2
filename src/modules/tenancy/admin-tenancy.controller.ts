import { Body, Controller, Get, Post, Render, Request, Res, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { VERSION } from 'src/enum/version.enum';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enum/role.enum';
import { AuthService } from '../auth/auth.service';
import { RequestUser } from 'src/interfaces/RequestUser';
import { Response } from 'express';
import { PrismaService } from 'src/infra/prisma/prisma.service';

@ApiTags('Admin Tenancy')
@Controller({
    version: VERSION.V1,
    path: 'admin/tenants',
})
@Roles(Role.SUPER_ADMIN)
export class AdminTenancyController {
    constructor(
        private readonly authService: AuthService,
        private readonly prisma: PrismaService,
    ) { }

    @Get()
    @Render('tenants')
    async tenantsPage(@Request() req: RequestUser) {
        const tenants = await this.prisma.multitenancy.findMany({
            include: {
                _count: {
                    select: {
                        users: true,
                        territories: true,
                        houses: true,
                    }
                },
                round: {
                    where: {
                        // not null
                        updateDate: { not: null }
                    },
                    orderBy: { updateDate: 'desc' },
                    take: 1,
                    select: {
                        updateDate: true,
                        startDate: true,
                        completedDate: true
                    }
                }
            },
            orderBy: { name: 'asc' }
        });

        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

        const formattedTenants = tenants.map(t => {
            const lastDate = t.round?.[0]?.updateDate || t.round?.[0]?.startDate || t.round?.[0]?.completedDate || null;
            return {
                ...t,
                lastActivity: lastDate,
                isInactive: !lastDate || lastDate < oneMonthAgo
            };
        }).sort((a, b) => {
            if (a.lastActivity && b.lastActivity) {
                return b.lastActivity.getTime() - a.lastActivity.getTime();
            } else if (a.lastActivity) {
                return -1;
            } else if (b.lastActivity) {
                return 1;
            } else {
                return 0;
            }
        });

        return {
            tenants: formattedTenants,
            user: req.user,
            isSuperAdmin: true,
            activePage: 'tenants',
        };
    }

    @Post('switch')
    async switchTenant(@Body('tenantId') tenantId: string, @Request() req: RequestUser, @Res() res: Response) {
        const { token } = await this.authService.switchTenant(req.user.userId, +tenantId);
        res.cookie('access_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 24 * 60 * 60 * 1000,
        });
        return res.redirect('/v1/dashboard');
    }

    @Patch(':id')
    async updateTenant(@Param('id') id: string, @Body() body: any) {
        return this.prisma.multitenancy.update({
            where: { id: +id },
            data: {
                name: body.name,
                city: body.city,
                state: body.state,
                phone: body.phone,
            }
        });
    }
}
