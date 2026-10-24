import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Role } from 'src/enum/role.enum';
import { Roles } from 'src/decorators/roles.decorator';
import { SkipCache } from 'src/decorators/skip-cache.decorator';
import { CreateReportDto } from './contracts/CreateReport';
import { ChangeRequestService } from '../change-request/change-request.service';
import { PrismaService } from 'src/infra/prisma/prisma.service';

/** Compatibility adapter. Report ids identify requests; houseId identifies the house. */
@Controller({version:'1',path:'reports'})
@SkipCache()
export class ReportController {
  constructor(private readonly requests: ChangeRequestService, private readonly prisma: PrismaService) {}
  @Get()
  @Roles(Role.ADMIN)
  async getReports(@Req() req: any) {
    const result=await this.requests.list(req.user,{status:'pending',entity:'house',limit:'100'});
    return result.items.map(row=>{const data=row.proposedData as any;const context=data._context??{};return {...data,id:row.id,houseId:row.targetId,tenantId:row.tenantId,territoryId:row.territoryId,blockId:row.blockId,addressId:row.addressId,reportType:({create:'add',update:'update',delete:'remove'})[row.action],observations:row.observations,territory:{name:context.territory??''},block:{name:context.block??''},address:{name:context.street??''},version:row.version};});
  }
  @Post()
  @Roles(Role.ADMIN,Role.DIRIGENTE,Role.PUBLICADOR)
  @UsePipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}))
  async createReport(@Req() req:any,@Body() body:CreateReportDto) {
    const {id,reportType,territoryId,blockId,addressId,observations,territoryBlockAddressId,...data}=body;
    const mapping=await this.prisma.territory_block_address.findFirst({where:{...(territoryBlockAddressId?{id:territoryBlockAddressId}:{}),tenantId:req.user.tenantId,addressId,registrationStatus:{not:'rejected'},territoryBlock:{territoryId,blockId,registrationStatus:{not:'rejected'}}}});
    if(!mapping)throw new NotFoundException('Vínculo da rua não encontrado');
    const row=await this.requests.create(req.user,{entity:'house',action:({add:'create',update:'update',remove:'delete'} as const)[reportType],territoryId,blockId,addressId,houseId:id,data:reportType==='remove'?{}:data,observations});
    return {...row,number:(row.proposedData as any).number,houseId:row.targetId,territoryBlockAddressId:mapping.id,reportType};
  }
  @Post('approve/:id')
  @Roles(Role.ADMIN)
  async approve(@Req() req:any,@Param('id',ParseIntPipe) id:number,@Body() body:any) {
    const row=await this.requests.detail(req.user,id);
    return this.requests.review(req.user,'approve',[{id,version:row.version,impactToken:body?.impactToken}],{confirmDeletion:body?.confirmDeletion===true});
  }
  @Post('cancel/:id')
  @Roles(Role.ADMIN)
  async cancel(@Req() req:any,@Param('id',ParseIntPipe) id:number,@Body() body:any) {
    const row=await this.requests.detail(req.user,id);
    return this.requests.review(req.user,'reject',[{id,version:row.version,impactToken:body?.impactToken}],{reason:body?.reason??'Rejeitado pelo administrador',confirmDeletion:body?.confirmDeletion===true});
  }
}
