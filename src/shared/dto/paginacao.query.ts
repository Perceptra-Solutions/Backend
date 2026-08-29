import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Paginacao por offset — para as telas de gestao, onde o total importa
 * e o conjunto e pequeno. A fila de deteccoes usa cursor (ver
 * CursorQuery), porque e a unica lista que cresce sem limite.
 */
export class PaginacaoQuery {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  tamanho: number = 20;

  get pular(): number {
    return (this.pagina - 1) * this.tamanho;
  }
}
