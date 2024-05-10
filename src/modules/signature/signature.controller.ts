import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Request } from '@nestjs/common';
import { SignatureService } from './signature.service';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/decorators/public.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enum/role.enum';
import { VERSION } from 'src/enum/version.enum';
import { logger } from 'src/infra/logger';
import { RequestUser } from 'src/interfaces/RequestUser';

class InputSignature {
  @ApiProperty({ description: 'Data de expiração', example: '2021-01-01T00:00:00.000Z', required: true })
  expirationTime: string;
  @ApiProperty({ description: 'Dirigente', example: 'João', required: true })
  overseer: string;
  @ApiProperty({ description: 'Número da rodada', example: 1, required: true })
  round: number;
}

@ApiTags('Signature')
@Controller({
  version: VERSION.V1,
})
export class SignatureController {
  constructor(private readonly signatureService: SignatureService) {}

  @Public()
  @Get('signature/:signatureId')
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
      if (!expirationTime) throw new BadRequestException('Tempo de expiração são obrigatório');
      if (!overseer) throw new BadRequestException('Supervisor são obrigatório');
      if (!round) throw new BadRequestException('Número da rodada são obrigatório');
      if (isNaN(Number(round))) throw new BadRequestException('Número da rodada inválida');
      if (Number(round) < 1) throw new BadRequestException('Número da rodada inválida');

      await this.signatureService.isTerritoryRound(Number(territoryId));

      const result = await this.signatureService.generateTerritory({
        territoryId,
        expirationTime,
        overseer,
        tenantId: req.user.tenantId,
        round,
      });

      return result;
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }

  @ApiBearerAuth()
  @Post('territories/:territoryId/blocks/:blockId/signature')
  @Roles(Role.ADMIN, Role.DIRIGENTE)
  async createSignatureTerritoryBlock(
    @Param('territoryId') territoryIdSerialize: string,
    @Param('blockId') blockIdSerialize: string,
    @Request() req: RequestUser
  ) {
    try {
      if (!territoryIdSerialize) throw new BadRequestException('Território são obrigatório');
      const territoryId = Number(territoryIdSerialize);
      if (isNaN(territoryId)) throw new BadRequestException('Território inválido');

      if (!blockIdSerialize) throw new BadRequestException('Bloco são obrigatório');
      const blockId = Number(blockIdSerialize);
      if (isNaN(blockId)) throw new BadRequestException('Bloco inválido');

      const result = await this.signatureService.generateTerritoryBlock({
        territoryId,
        blockId,
        tenantId: req.user.tenantId,
      });

      return result;
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }

  @ApiBearerAuth()
  @Delete('territories/:territoryId/signature')
  @Roles(Role.ADMIN)
  async deleteSignatureTerritory(@Param('territoryId') territoryIdSerialize: string) {
    try {
      if (!territoryIdSerialize) throw new BadRequestException('Território são obrigatório');
      const territoryId = Number(territoryIdSerialize);

      return await this.signatureService.deleteTerritorySignature(territoryId);
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }

  @ApiBearerAuth()
  @Delete('territories/:territoryId/blocks/:blockId/signature')
  @Roles(Role.ADMIN, Role.DIRIGENTE)
  async deleteSignatureTerritoryBlock(@Param('territoryId') territoryIdSerialize: string, @Param('blockId') blockIdSerialize: string) {
    try {
      if (!territoryIdSerialize) throw new BadRequestException('Território são obrigatório');
      const territoryId = Number(territoryIdSerialize);
      if (isNaN(territoryId)) throw new BadRequestException('Território inválido');

      if (!blockIdSerialize) throw new BadRequestException('Bloco são obrigatório');
      const blockId = Number(blockIdSerialize);
      if (isNaN(blockId)) throw new BadRequestException('Bloco inválido');

      return await this.signatureService.deleteBlockSignature(territoryId, blockId);
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }
}
