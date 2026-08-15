import { BadRequestException, Body, Controller, Delete, Get, Logger, Param, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from 'src/decorators/public.decorator';
import { VERSION } from 'src/enum/version.enum';

import { CreateAssignmentDto } from './contracts/CreateAssignmentDto';
import { DeleteAssignmentDto } from './contracts/DeleteAssignmentDto';
import { JoinRoomDto } from './contracts/JoinRoomDto';
import { WaitingRoomService } from './waiting-room.service';

@ApiTags('Waiting Room')
@Controller({
  version: VERSION.V1,
  path: 'waiting-room',
})
export class WaitingRoomController {
  private readonly logger = new Logger(WaitingRoomController.name);

  constructor(private readonly waitingRoomService: WaitingRoomService) {}

  private identityKey(req: Request): string {
    const sessionId = req.headers['session-id'];
    return typeof sessionId === 'string' && sessionId ? sessionId : 'anonymous';
  }

  @Public()
  @Get('groups')
  @ApiOperation({ summary: 'Lista grupos ativos (com dirigente presente há menos de 2min)' })
  async listGroups(@Query('s') signatureKey: string, @Req() req: Request) {
    try {
      const ctx = await this.waitingRoomService.resolveTenantContext(signatureKey, this.identityKey(req));
      return await this.waitingRoomService.listActiveGroups(ctx.tenantId);
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  @Public()
  @Post('groups/:groupId/join')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Entra na sala como dirigente (com territoryId) ou publicador' })
  async join(@Param('groupId') groupId: string, @Body() body: JoinRoomDto, @Query('s') signatureKey: string, @Req() req: Request) {
    try {
      const ctx = await this.waitingRoomService.resolveTenantContext(signatureKey, this.identityKey(req));
      return await this.waitingRoomService.joinRoom({
        groupId,
        tenantId: ctx.tenantId,
        identityKey: ctx.identityKey,
        body,
      });
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  @Public()
  @Post('groups/:groupId/heartbeat')
  @ApiOperation({ summary: 'Renova o lastSeenAt da presença do identityKey' })
  async heartbeat(@Param('groupId') groupId: string, @Query('s') signatureKey: string, @Req() req: Request) {
    try {
      const ctx = await this.waitingRoomService.resolveTenantContext(signatureKey, this.identityKey(req));
      return await this.waitingRoomService.heartbeat({
        groupId,
        tenantId: ctx.tenantId,
        identityKey: ctx.identityKey,
      });
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  @Public()
  @Get('groups/:groupId')
  @ApiOperation({ summary: 'Estado da sala conforme o papel (dirigente vence sobre publicador)' })
  async getRoom(@Param('groupId') groupId: string, @Query('s') signatureKey: string, @Req() req: Request) {
    try {
      const ctx = await this.waitingRoomService.resolveTenantContext(signatureKey, this.identityKey(req));
      return await this.waitingRoomService.getRoom({
        groupId,
        tenantId: ctx.tenantId,
        identityKey: ctx.identityKey,
      });
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  @Public()
  @Post('groups/:groupId/assignments')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Atribui um publicador a uma quadra do território' })
  async createAssignment(@Param('groupId') groupId: string, @Body() body: CreateAssignmentDto, @Query('s') signatureKey: string, @Req() req: Request) {
    try {
      const ctx = await this.waitingRoomService.resolveTenantContext(signatureKey, this.identityKey(req));
      return await this.waitingRoomService.createAssignment({
        groupId,
        tenantId: ctx.tenantId,
        body,
      });
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  @Public()
  @Delete('groups/:groupId/assignments')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Remove a atribuição de um publicador a uma quadra' })
  async removeAssignment(@Param('groupId') groupId: string, @Body() body: DeleteAssignmentDto, @Query('s') signatureKey: string, @Req() req: Request) {
    try {
      const ctx = await this.waitingRoomService.resolveTenantContext(signatureKey, this.identityKey(req));
      return await this.waitingRoomService.removeAssignment({
        groupId,
        tenantId: ctx.tenantId,
        body,
      });
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  @Public()
  @Post('groups/:groupId/blocks/:blockId/signature')
  @ApiOperation({ summary: 'Gera link de compartilhamento da quadra (kind=block)' })
  async generateBlockSignature(@Param('groupId') groupId: string, @Param('blockId') blockId: string, @Query('s') signatureKey: string, @Req() req: Request) {
    try {
      const ctx = await this.waitingRoomService.resolveTenantContext(signatureKey, this.identityKey(req));
      const parsedBlockId = Number(blockId);
      if (!Number.isFinite(parsedBlockId)) {
        throw new BadRequestException('Bloco inválido');
      }
      return await this.waitingRoomService.generateBlockSignature({
        groupId,
        tenantId: ctx.tenantId,
        identityKey: ctx.identityKey,
        blockId: parsedBlockId,
      });
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }
}
