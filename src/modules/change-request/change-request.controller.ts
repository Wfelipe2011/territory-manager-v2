import { Body, Controller, Get, Header, Param, ParseIntPipe, Post, Query, Req, Res, UsePipes, ValidationPipe, BadRequestException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { Role } from 'src/enum/role.enum';
import { Roles } from 'src/decorators/roles.decorator';
import { SkipCache } from 'src/decorators/skip-cache.decorator';
import { ChangeRequestService, ReviewItem } from './change-request.service';
import { CreateChangeRequest } from './contracts';

@Controller({ version: '1', path: 'change-requests' })
@Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.DIRIGENTE, Role.PUBLICADOR)
@SkipCache()
export class ChangeRequestController {
  constructor(private readonly requests: ChangeRequestService) {}
  @Post()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  create(@Req() req: any, @Body() body: CreateChangeRequest) {
    return this.requests.create(req.user, body);
  }
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Req() req: any, @Query() query: Record<string, string>) {
    return this.requests.list(req.user, query);
  }
  @Get('sync')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  async sync(@Req() req: any, @Res({ passthrough: true }) res: Response, @Query('cursor') cursor?: string) {
    const abort = new AbortController();
    const cancel = () => abort.abort();
    req.once('aborted', cancel);
    res.once('close', cancel);
    try {
      return await this.requests.sync(req.user, cursor, abort.signal);
    } finally {
      req.off('aborted', cancel);
      res.off('close', cancel);
    }
  }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  detail(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.requests.detail(req.user, id);
  }
  @Post('review')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  review(@Req() req: any, @Body() body: { decision: 'approve' | 'reject'; items: ReviewItem[]; reason?: string; confirmDeletion?: boolean }) {
    if (!['approve', 'reject'].includes(body.decision)) throw new BadRequestException('Decisão inválida');
    return this.requests.review(req.user, body.decision, body.items, { reason: body.reason, confirmDeletion: body.confirmDeletion === true });
  }
}
