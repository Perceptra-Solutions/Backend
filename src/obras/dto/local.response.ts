import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { TipoLocal } from '../../shared/enums/dominio.enums.js';
import type { Local } from '../local.entity.js';

export class LocalResponse {
  @ApiProperty() id!: string;
  @ApiProperty() obraId!: string;
  @ApiProperty() tipo!: TipoLocal;
  @ApiProperty() nome!: string;
  @ApiPropertyOptional({ nullable: true }) codigo!: string | null;

  static de(l: Local): LocalResponse {
    return {
      id: l.id,
      obraId: l.obraId,
      tipo: l.tipo,
      nome: l.nome,
      codigo: l.codigo,
    };
  }
}
