import { Controller, Delete, Get, Header, Param, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { Roles } from 'src/decorators/roles.decorator';
import { SkipCache } from 'src/decorators/skip-cache.decorator';
import { Role } from 'src/enum/role.enum';
import { RequestSignature } from 'src/interfaces/RequestUser';
import { FieldQuery, FieldService } from './field.service';

@ApiTags('Field')
@ApiBearerAuth()
@Roles(Role.DIRIGENTE, Role.PUBLICADOR)
@Controller({ version: '1', path: 'field' })
export class FieldController {
  constructor(private readonly field: FieldService) {}

  @Get('blocks/:blockId/sync')
  @SkipCache()
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Quadra completa: ruas, casas e permissões em um único long polling' })
  async blockSync(@Param('blockId') blockId: string, @Req() req: RequestSignature, @Res({ passthrough: true }) res: Response, @Query() query: FieldQuery) {
    return this.poll(req, res, { ...query, scope: 'block', blockId, addressId: undefined }, true);
  }

  @Get('sync')
  @SkipCache()
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Estado mobile e presença; aguarda alterações por até 25 segundos' })
  async sync(@Req() req: RequestSignature, @Res({ passthrough: true }) res: Response, @Query() query: FieldQuery) {
    return this.poll(req, res, query);
  }

  private async poll(req: RequestSignature, res: Response, query: FieldQuery, fullBlock = false) {
    const abort = new AbortController();
    const cancel = () => abort.abort();
    req.once('aborted', cancel);
    res.once('close', cancel);
    try {
      return await this.field.poll(req.user, query, abort.signal, fullBlock, req);
    } finally {
      req.off('aborted', cancel);
      res.off('close', cancel);
    }
  }

  @Delete('session')
  @Header('Cache-Control', 'no-store')
  async leave(@Req() req: RequestSignature, @Query() query: FieldQuery) {
    await this.field.leave(req.user, query);
    return { ok: true };
  }
}
