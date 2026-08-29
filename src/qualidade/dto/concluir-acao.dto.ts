import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ConcluirAcaoDto {
  @ApiPropertyOptional({ description: 'Causa raiz, se so ficou clara ao executar.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  causaRaiz?: string;

  @ApiPropertyOptional({ example: 2350.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  custo?: number;
}
