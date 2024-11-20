import { IsNumber, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class FindAllParams {
  @IsNumber()
  @Transform(({ value }) => Number(value), { toClassOnly: true })
  page: number;

  @IsNumber()
  @Transform(({ value }) => Number(value), { toClassOnly: true })
  limit: number;

  @IsString()
  sort: string;
}
