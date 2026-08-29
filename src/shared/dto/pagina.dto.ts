import { ApiProperty } from '@nestjs/swagger';

export class PaginaDto<T> {
  @ApiProperty({ isArray: true })
  itens!: T[];

  @ApiProperty({ example: 137 })
  total!: number;

  @ApiProperty({ example: 1 })
  pagina!: number;

  @ApiProperty({ example: 20 })
  tamanho!: number;

  @ApiProperty({ example: 7 })
  totalPaginas!: number;

  static de<T>(itens: T[], total: number, pagina: number, tamanho: number): PaginaDto<T> {
    return {
      itens,
      total,
      pagina,
      tamanho,
      totalPaginas: tamanho > 0 ? Math.ceil(total / tamanho) : 0,
    };
  }
}
