import { ChangeAction, ChangeEntity } from '@prisma/client';
import { IsEnum, IsInt, IsObject, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateChangeRequest {
  @IsEnum(ChangeEntity) entity: ChangeEntity;
  @IsEnum(ChangeAction) action: ChangeAction;
  @IsInt() @Min(1) territoryId: number;
  @IsOptional() @IsInt() @Min(1) blockId?: number;
  @IsOptional() @IsInt() @Min(1) addressId?: number;
  @IsOptional() @IsInt() @Min(1) houseId?: number;
  @IsOptional() @IsInt() @Min(1) targetId?: number;
  @IsObject() data: Record<string, unknown>;
  @IsString() @MinLength(1) @MaxLength(1000) observations: string;
}
