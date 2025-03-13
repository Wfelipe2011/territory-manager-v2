import { Controller, Get, Query, Res, UsePipes, ValidationPipe } from '@nestjs/common';
import { RecordsService } from './records.service';
import { RecordsParams } from './dto/records-params';
import { CurrentUser } from 'src/decorators/current-user.decorator';
import { UserToken } from '../auth/contracts';
import { VERSION } from 'src/enum/version.enum';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import * as Papa from 'papaparse';
import { Response } from 'express';

@ApiTags('Records')
@ApiBearerAuth()
@Controller({
  version: VERSION.V1,
  path: 'records',
})
export class RecordsController {
  constructor(private readonly recordsService: RecordsService) { }

  @Get()
  @ApiOperation({ summary: 'Lista registros dentro de um intervalo de datas' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async findAll(@Query() query: RecordsParams, @CurrentUser() user: UserToken, @Res() res: Response) {
    const records = await this.recordsService.find(user.tenantId, query.dateFrom, query.dateTo);

    const csv = Papa.unparse(records);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="registros.csv"');

    return res.send(csv);
  }
}
