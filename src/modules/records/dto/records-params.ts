import { ApiProperty } from "@nestjs/swagger";
import { IsDateString } from "class-validator";

export class RecordsParams {
  @ApiProperty({
    required: true,
    description: 'Data de início no formato yyyy-MM-dd',
    type: String,
    example: '2024-01-01'
  })
  @IsDateString({ strict: true }, { message: 'Data inicio deve ser preenchida no formato yyyy-MM-dd' })
  dateFrom: string;

  @ApiProperty({
    required: true,
    description: 'Data de fim no formato yyyy-MM-dd',
    type: String,
    example: '2024-01-31'
  })
  @IsDateString({ strict: true }, { message: 'Data fim deve ser preenchida no formato yyyy-MM-dd' })
  dateTo: string;
}
