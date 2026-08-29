import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ModeloIa } from '../modelo-ia.entity.js';

export class ModeloIaResponse {
  @ApiProperty() id!: string;
  @ApiProperty() nome!: string;
  @ApiProperty() versao!: string;
  @ApiProperty() tipoDeteccao!: string;
  @ApiProperty() limiarConfianca!: number;
  @ApiPropertyOptional({ nullable: true }) metricas!: Record<string, unknown> | null;
  @ApiPropertyOptional({ nullable: true }) hashArtefato!: string | null;
  @ApiProperty() publicadoEm!: string;
  @ApiProperty() ativo!: boolean;

  static de(m: ModeloIa): ModeloIaResponse {
    return {
      id: m.id,
      nome: m.nome,
      versao: m.versao,
      tipoDeteccao: m.tipoDeteccao,
      limiarConfianca: m.limiarConfianca,
      metricas: m.metricas,
      hashArtefato: m.hashArtefato,
      publicadoEm: m.publicadoEm,
      ativo: m.ativo,
    };
  }
}
