import { IsNumber, IsString, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTerritoryParams {
  @IsNotEmpty({ message: 'Nome é obrigatório' })
  @IsString({ message: 'Nome deve ser um texto' })
  name: string;

  @IsNotEmpty({ message: 'Tipo é obrigatório' })
  @IsNumber({ allowNaN: false }, { message: 'Tipo deve ser um número' })
  @Type(() => Number)
  typeId: number;
}
