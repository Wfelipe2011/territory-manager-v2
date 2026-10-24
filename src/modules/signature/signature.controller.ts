import { BadRequestException, Body, Controller, Delete, Get, Header, Logger, Param, Patch, Post, Request } from '@nestjs/common';
import { SignatureService } from './signature.service';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { SignatureDate } from './usecase/SignatureDate';
import { Throttle } from '@nestjs/throttler';
import { SkipCache } from 'src/decorators/skip-cache.decorator';
import { Public } from 'src/decorators/public.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enum/role.enum';
import { VERSION } from 'src/enum/version.enum';
import { RequestSignature, RequestUser } from 'src/interfaces/RequestUser';

const logger = new Logger('SignatureController');
class InputSignature {
  @ApiProperty({ description: 'Data de expiração', example: '2021-01-01T00:00:00.000Z', required: true })
  expirationTime: string;
  @ApiProperty({ description: 'Dirigente', example: 'João', required: true })
  overseer: string;
  @ApiProperty({ description: 'Número da rodada', example: 1, required: true })
  round?: number | null;
  canEditStructure?: boolean;
}

@ApiTags('Signature')
@Controller({
  version: VERSION.V1,
})
export class SignatureController {
  constructor(private readonly signatureService: SignatureService) { }

  @Public()
  @Get('signature/:signatureId')
  @Throttle(30, 60)
  @SkipCache()
  @Header('Cache-Control', 'no-store')
  async getSignature(@Param('signatureId') signatureId: string) {
    try {
      if (!signatureId) throw new BadRequestException('Assinatura são obrigatório');
      const result = await this.signatureService.findTokenById(signatureId);
      return result;
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }

  @ApiBearerAuth()
  @Post('territories/:territoryId/signature')
  @Roles(Role.ADMIN)
  async createSignatureTerritory(@Body() body: InputSignature, @Param('territoryId') territoryIdSerialize: string, @Request() req: RequestUser) {
    try {
      if (!territoryIdSerialize) throw new BadRequestException('Território são obrigatório');
      const territoryId = Number(territoryIdSerialize);
      if (isNaN(territoryId)) throw new BadRequestException('Território inválido');

      const { expirationTime, overseer, round } = body;
      if (body.canEditStructure !== undefined && typeof body.canEditStructure !== 'boolean') throw new BadRequestException('Permissão inválida');
      if (!expirationTime) throw new BadRequestException('Tempo de expiração são obrigatório');
      if (!overseer) throw new BadRequestException('Supervisor são obrigatório');
      if (round != null && isNaN(Number(round))) throw new BadRequestException('Número da rodada inválida');
      if (round != null && Number(round) < 1) throw new BadRequestException('Número da rodada inválida');

      new SignatureDate().isValidDate(expirationTime);
      await this.signatureService.isTerritoryRound(territoryId, req.user.tenantId, round == null ? null : +round);

      const result = await this.signatureService.generateTerritory({
        territoryId,
        expirationTime,
        overseer,
        tenantId: req.user.tenantId,
        round: round == null ? null : +round,
        canEditStructure: body.canEditStructure === true,
      });

      return result;
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }

  @ApiBearerAuth()
  @Post(['territories/:territoryId/blocks/:blockId/signature/:round','territories/:territoryId/blocks/:blockId/signature'])
  @Roles(Role.ADMIN, Role.DIRIGENTE)
  async createSignatureTerritoryBlock(
    @Param('territoryId') territoryIdSerialize: string,
    @Param('blockId') blockIdSerialize: string,
    @Param('round') round: string,
    @Request() req: RequestSignature
  ) {
    try {
      if (!territoryIdSerialize) throw new BadRequestException('Território são obrigatório');
      const territoryId = Number(territoryIdSerialize);
      if (isNaN(territoryId)) throw new BadRequestException('Território inválido');

      if (!blockIdSerialize) throw new BadRequestException('Bloco são obrigatório');
      const blockId = Number(blockIdSerialize);
      if (isNaN(blockId)) throw new BadRequestException('Bloco inválido');

      if (round != null && isNaN(Number(round))) throw new BadRequestException('Número da rodada inválida');
      if (round != null && Number(round) < 1) throw new BadRequestException('Número da rodada inválida');

      const result = await this.signatureService.generateTerritoryBlock({
        territoryId,
        blockId,
        tenantId: req.user.tenantId,
        round: req.user.roles.includes(Role.DIRIGENTE) ? (req.user.round == null ? null : +req.user.round) : round == null ? null : +round,
        parentSignature: req.user.roles.includes(Role.DIRIGENTE) ? req.user.id : undefined,
      });

      return result;
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }

  @Patch('signature/:code/permissions')
  @Roles(Role.ADMIN)
  async permissions(@Param('code') code: string,@Request() req:RequestUser,@Body() body:{canEditStructure:boolean}) {
    if (typeof body.canEditStructure !== 'boolean') throw new BadRequestException('Permissão inválida');
    return this.signatureService.setPermissions(/^[a-z0-9]{6}$/i.test(code) ? code.toUpperCase() : code,req.user.tenantId,body.canEditStructure);
  }

  @Get('territories/:territoryId/signature')
  @Roles(Role.ADMIN)
  @SkipCache()
  @Header('Cache-Control','no-store')
  catalogSignature(@Param('territoryId') territoryId: string,@Request() req:RequestUser) {
    if(!Number.isSafeInteger(+territoryId)||+territoryId<1)throw new BadRequestException('Território inválido');
    return this.signatureService.catalogSignature(+territoryId,req.user.tenantId);
  }

  @ApiBearerAuth()
  @Delete('territories/:territoryId/signature')
  @Roles(Role.ADMIN)
  async deleteSignatureTerritory(@Param('territoryId') territoryIdSerialize: string, @Request() req: RequestUser) {
    try {
      if (!territoryIdSerialize) throw new BadRequestException('Território são obrigatório');
      const territoryId = Number(territoryIdSerialize);

      return await this.signatureService.deleteTerritorySignature(territoryId, req.user.tenantId);
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }

  @ApiBearerAuth()
  @Delete('territories/:territoryId/blocks/:blockId/signature')
  @Roles(Role.ADMIN, Role.DIRIGENTE)
  async deleteSignatureTerritoryBlock(@Param('territoryId') territoryIdSerialize: string, @Param('blockId') blockIdSerialize: string, @Request() req: RequestSignature) {
    try {
      if (!territoryIdSerialize) throw new BadRequestException('Território são obrigatório');
      const territoryId = Number(territoryIdSerialize);
      if (isNaN(territoryId)) throw new BadRequestException('Território inválido');

      if (!blockIdSerialize) throw new BadRequestException('Bloco são obrigatório');
      const blockId = Number(blockIdSerialize);
      if (isNaN(blockId)) throw new BadRequestException('Bloco inválido');

      return await this.signatureService.deleteBlockSignature(territoryId, blockId, req.user.tenantId, req.user.roles.includes(Role.DIRIGENTE) ? +req.user.round : undefined);
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }
}
