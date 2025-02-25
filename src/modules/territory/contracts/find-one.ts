import { IsNotEmpty, IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class FindOneParams {
  @ApiProperty({
    required: false,
    description: 'Id da quadra',
    type: Number,
    example: 1
  })
  @IsOptional()
  @IsNumber({}, { message: 'Id da quadra deve ser um número' })
  @Type(() => Number)
  blockId?: number;
}
