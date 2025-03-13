import { IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class FindAllParams {
  @IsNumber()
  @Type(() => Number)
  page: number;

  @IsNumber()
  @Type(() => Number)
  limit: number;

  @IsString()
  sort: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  type?: number;
}
