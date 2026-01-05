import { Body, Controller, Delete, Get, Param, Post, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enum/role.enum';
import { VERSION } from 'src/enum/version.enum';
import { RequestUser } from 'src/interfaces/RequestUser';
import { ParametersService } from './parameters.service';
import { UpsertParameterDto } from './contracts/UpsertParameterDto';

@ApiTags('Parameters')
@ApiBearerAuth()
@Controller({
    version: VERSION.V1,
    path: 'parameters',
})
export class ParametersController {
    constructor(private readonly parametersService: ParametersService) { }

    @Get()
    @Roles(Role.ADMIN)
    @ApiOperation({ summary: 'Listar todos os parâmetros do tenant' })
    async findAll(@Request() req: RequestUser) {
        return this.parametersService.findAll(+req.user.tenantId);
    }

    @Get(':key')
    @Roles(Role.ADMIN)
    @ApiOperation({ summary: 'Buscar um parâmetro específico pela chave' })
    async findOne(@Request() req: RequestUser, @Param('key') key: string) {
        return this.parametersService.findByKey(+req.user.tenantId, key);
    }

    @Post()
    @Roles(Role.ADMIN)
    @ApiOperation({ summary: 'Criar ou atualizar um parâmetro' })
    async upsert(@Request() req: RequestUser, @Body() data: UpsertParameterDto) {
        return this.parametersService.upsert(+req.user.tenantId, data);
    }

    @Delete(':key')
    @Roles(Role.ADMIN)
    @ApiOperation({ summary: 'Remover um parâmetro' })
    async delete(@Request() req: RequestUser, @Param('key') key: string) {
        return this.parametersService.delete(+req.user.tenantId, key);
    }
}
