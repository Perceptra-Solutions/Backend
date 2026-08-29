import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { SeveridadeNc, StatusNc, TipoRelatorio } from '../../shared/enums/dominio.enums.js';
import type { Relatorio } from '../relatorio.entity.js';

/** Uma NC como ela ficou congelada no relatorio, na ordem persistida. */
export class ItemRelatorioResponse {
  @ApiProperty()
  ordem!: number;

  @ApiProperty()
  naoConformidadeId!: string;

  @ApiProperty({ example: 'NC-2026-000012' })
  codigo!: string;

  @ApiProperty()
  titulo!: string;

  @ApiProperty({ enum: SeveridadeNc })
  severidade!: SeveridadeNc;

  @ApiProperty({ enum: StatusNc })
  status!: StatusNc;
}

export class RelatorioResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  obraId!: string;

  @ApiProperty({ enum: TipoRelatorio })
  tipo!: TipoRelatorio;

  @ApiProperty()
  titulo!: string;

  @ApiPropertyOptional({ nullable: true })
  periodoInicio!: string | null;

  @ApiPropertyOptional({ nullable: true })
  periodoFim!: string | null;

  @ApiPropertyOptional({ nullable: true })
  geradoPor!: string | null;

  @ApiProperty()
  geradoEm!: Date;

  @ApiProperty({ description: 'Quantas NCs entraram no snapshot.' })
  totalItens!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'SHA-256 do arquivo gerado. Confira com GET /relatorios/{id}/integridade.',
  })
  hashSha256!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'URL assinada de download. `null` quando o driver de storage e o local.',
  })
  urlTemporaria!: string | null;

  @ApiPropertyOptional({ type: () => [ItemRelatorioResponse] })
  itens?: ItemRelatorioResponse[];

  /**
   * Mapeamento explicito. `arquivoUri` NAO e exposto de proposito: e a chave
   * interna do bucket, e vazar caminho de storage numa API publica so ajuda
   * quem esta sondando. O download sai por /relatorios/{id}/arquivo.
   */
  static de(
    relatorio: Relatorio,
    totalItens: number,
    urlTemporaria: string | null,
    itens?: ItemRelatorioResponse[],
  ): RelatorioResponse {
    return {
      id: relatorio.id,
      obraId: relatorio.obraId,
      tipo: relatorio.tipo,
      titulo: relatorio.titulo,
      periodoInicio: relatorio.periodoInicio,
      periodoFim: relatorio.periodoFim,
      geradoPor: relatorio.geradoPor,
      geradoEm: relatorio.geradoEm,
      totalItens,
      hashSha256: relatorio.hashSha256,
      urlTemporaria,
      ...(itens ? { itens } : {}),
    };
  }
}
