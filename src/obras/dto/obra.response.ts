import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { StatusObra } from '../../shared/enums/dominio.enums.js';
import type { Obra } from '../obra.entity.js';

export class ObraResponse {
  @ApiProperty() id!: string;
  @ApiProperty() codigo!: string;
  @ApiProperty() nome!: string;
  @ApiPropertyOptional({ nullable: true }) endereco!: string | null;
  @ApiPropertyOptional({ nullable: true }) cidade!: string | null;
  @ApiPropertyOptional({ nullable: true }) uf!: string | null;
  @ApiProperty() status!: StatusObra;
  @ApiPropertyOptional({ nullable: true }) responsavelTecnicoId!: string | null;
  @ApiPropertyOptional({ nullable: true }) inicioPrevisto!: string | null;
  @ApiPropertyOptional({ nullable: true }) fimPrevisto!: string | null;
  @ApiProperty() criadoEm!: Date;

  static de(o: Obra): ObraResponse {
    return {
      id: o.id,
      codigo: o.codigo,
      nome: o.nome,
      endereco: o.endereco,
      cidade: o.cidade,
      uf: o.uf,
      status: o.status,
      responsavelTecnicoId: o.responsavelTecnicoId,
      inicioPrevisto: o.inicioPrevisto,
      fimPrevisto: o.fimPrevisto,
      criadoEm: o.criadoEm,
    };
  }
}
