import { ApiProperty } from '@nestjs/swagger';
import { RawTerritoryAll, RawTerritoryOne } from '../interfaces';
import dayjs from 'dayjs';
import { logger } from 'src/infra/logger';

export class RoundParams {
  @ApiProperty({ required: true, description: 'Qual a rodada do território', type: Number, example: 1 })
  round: number;
}

export class TerritoryTypesOutput {
  @ApiProperty({ required: false, description: 'Id do tipo de território', type: Number, example: 1 })
  id: number;
  @ApiProperty({ required: false, description: 'Nome do tipo de território', type: String, example: 'Residencial' })
  name: string;
}

export class Signature {
  @ApiProperty({ required: false, description: 'Data de expiração', type: Date, example: '2021-01-01T00:00:00.000Z' })
  expirationDate?: Date;

  @ApiProperty({ required: false, description: 'Chave da assinatura', type: String, example: 'fa1ec60b-1f15-4c43-8a79-87ebc687f35e' })
  key?: string;
}

export class TerritoryAllInput extends RoundParams {
  @ApiProperty({ required: false, description: 'Filtro de busca', type: String, example: 'Vila', default: '' })
  filter: string;

  @ApiProperty({ required: false, description: 'Tipo de território', type: Number, example: 1, default: 1 })
  type: number;
}

export class HistoryTerritory {
  @ApiProperty({ required: false, description: 'Nome do dirigente', type: String, example: 'João' })
  overseer: string;
  @ApiProperty({ required: false, description: 'Data de início', type: Date, example: '2021-01-01T00:00:00.000Z' })
  initialDate: Date;
  @ApiProperty({ required: false, description: 'Data de expiração', type: Date, example: '2021-01-01T00:00:00.000Z' })
  expirationDate?: Date;
  @ApiProperty({ required: false, description: 'Rodada está ativa?', type: Boolean, example: true })
  finished: boolean;
}

class Blocks {
  @ApiProperty({ required: false, description: 'Id do bloco', type: Number, example: 1 })
  id: number;
  @ApiProperty({ required: false, description: 'Nome do bloco', type: String, example: 'Vila Velha' })
  name: string;
  @ApiProperty({ required: false, description: 'Objeto de assinatura', type: Signature })
  signature?: Signature;
  @ApiProperty({ required: false, description: 'Quantidade de casas disponíveis', type: Number, example: 10 })
  positiveCompleted: number;
  @ApiProperty({ required: false, description: 'Quantidade de casa concluídas', type: Number, example: 20 })
  negativeCompleted: number;
  @ApiProperty({ required: false, description: 'Quantidade de conexões', type: Number, example: 1 })
  connections?: number;
}

enum Period {
  MORNING = 'morning',
  AFTERNOON = 'afternoon',
  EVENING = 'evening',
  WEEKEND = 'weekend',
}

class PositiveCompleted {
  @ApiProperty({ required: false, description: 'Data que foi concluída', type: Date, example: '2021-01-01T00:00:00.000Z' })
  date: Date;
  @ApiProperty({ required: false, description: 'Período que foi concluída', type: String, example: Period.MORNING })
  period: Period;
}

export class TerritoryAllOutput {
  @ApiProperty({ required: false, description: 'Id do território', type: Number, example: 1 })
  territoryId: number;
  @ApiProperty({ required: false, description: 'Nome do território', type: String, example: 'Vila Velha' })
  name: string;
  @ApiProperty({ required: false, description: 'Nome do dirigente', type: String, example: 'João' })
  overseer: string;

  @ApiProperty({ required: false, description: 'Objeto de assinatura', type: Signature })
  signature: Signature;

  @ApiProperty({ required: false, description: 'Rodada está ativa?', type: Boolean, example: true })
  hasRounds: boolean;

  @ApiProperty({ required: false, description: 'Quantidade de casa concluídas', type: PositiveCompleted, isArray: true })
  positiveCompleted: PositiveCompleted[];
  @ApiProperty({ required: false, description: 'Quantidade de casas disponíveis', type: Number, example: 1 })
  negativeCompleted: number;

  constructor(territoryAll: RawTerritoryAll) {
    this.territoryId = territoryAll.territory_id;
    this.name = territoryAll.name;
    this.overseer = territoryAll.overseer;
    this.signature = {
      expirationDate: territoryAll.expiration_date,
      key: territoryAll.key,
    };
    this.hasRounds = territoryAll.has_rounds;
    this.negativeCompleted = Number(territoryAll.negative_completed);
    this.positiveCompleted = this.mapPositiveCompleted(territoryAll);
  }

  private mapPositiveCompleted(territory: RawTerritoryAll): PositiveCompleted[] {
    return territory.positive_completed.map(date => {
      const day = dayjs(date);
      let period: Period;

      // Verificando se é manhã, tarde ou noite
      if (day.hour() >= 6 && day.hour() < 12) {
        period = Period.MORNING;
      } else if (day.hour() >= 12 && day.hour() < 18) {
        period = Period.AFTERNOON;
      } else {
        period = Period.EVENING;
      }

      // Verificando se é final de semana
      if (day.day() === 0 || day.day() === 6) {
        period = Period.WEEKEND;
      }

      return {
        date,
        period,
      };
    });
  }
}

export class TerritoryOneOutput {
  @ApiProperty({ required: false, description: 'Id do território', type: Number, example: 1 })
  territoryId: number;
  @ApiProperty({ required: false, description: 'Nome do território', type: String, example: 'Vila Velha' })
  territoryName: string;
  @ApiProperty({ required: false, description: 'Histórico de território', type: HistoryTerritory, isArray: true })
  history: HistoryTerritory[];
  @ApiProperty({ required: false, description: 'Rodada está ativa?', type: Boolean, example: true })
  hasRounds: boolean;
  @ApiProperty({ required: false, description: 'Objeto de assinatura', type: Blocks, isArray: true })
  blocks: Blocks[];
  @ApiProperty({ required: false, description: 'Url da imagem', type: String, example: 'https://...' })
  imageUrl?: string;

  constructor(territory: RawTerritoryOne[]) {
    const { territory_name, territory_id, has_rounds, image_url } = territory[0];
    this.territoryId = territory_id;
    this.territoryName = territory_name;
    this.imageUrl = image_url;
    this.history = territory.map(this.mapHistory).reduce(this.removeDuplicatedHistoryTerritory, []);
    this.hasRounds = has_rounds;
    this.blocks = territory.map(this.mapBlocks).reduce(this.removeDuplicatedBlocks, []);
  }

  private removeDuplicatedHistoryTerritory(acc: HistoryTerritory[], curr: HistoryTerritory): HistoryTerritory[] {
    const { initialDate, expirationDate, finished, overseer } = curr;
    if (!initialDate || !overseer) return acc;
    const duplicated = acc.some(a => a?.overseer === overseer && a.initialDate?.getTime() === initialDate?.getTime() && a?.finished === finished);
    if (!duplicated) acc.push(curr);
    return acc;
  }

  private removeDuplicatedBlocks(acc: Blocks[], curr: Blocks): Blocks[] {
    const { id, name } = curr;
    if (!id || !name) return acc;
    const duplicated = acc.some(a => a?.id === id && a?.name === name);
    if (!duplicated) acc.push(curr);
    return acc;
  }

  private mapHistory(territory: RawTerritoryOne): HistoryTerritory {
    return {
      overseer: territory.overseer,
      initialDate: territory.initial_date,
      expirationDate: territory.expiration_date,
      finished: territory.finished,
    };
  }

  private mapBlocks(territory: RawTerritoryOne): Blocks {
    return {
      id: territory.block_id,
      name: territory.block_name,
      positiveCompleted: Number(territory.positive_completed),
      negativeCompleted: Number(territory.negative_completed),
      signature: {
        key: territory?.signature_key,
        expirationDate: territory?.signature_expiration_date,
      },
    };
  }
}
