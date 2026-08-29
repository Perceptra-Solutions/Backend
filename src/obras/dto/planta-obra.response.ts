import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Obra } from '../obra.entity.js';

/**
 * Metadado da planta da obra. **Nunca** inclui `plantaUri`: é a chave interna
 * do storage, e vazar caminho de bucket numa API só ajuda quem está sondando.
 * O arquivo sai por `GET /obras/:id/planta`.
 */
export class PlantaObraResponse {
  @ApiProperty({ description: 'false quando a obra ainda não tem planta cadastrada.' })
  existe!: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Nome original do arquivo enviado.' })
  nome!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'image/png' })
  mime!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'SHA-256 do arquivo armazenado.' })
  hashSha256!: string | null;

  @ApiPropertyOptional({ nullable: true })
  tamanhoBytes!: string | null;

  @ApiPropertyOptional({ nullable: true })
  atualizadaEm!: Date | null;

  static de(o: Obra): PlantaObraResponse {
    return {
      existe: o.plantaHashSha256 !== null,
      nome: o.plantaNome,
      mime: o.plantaMime,
      hashSha256: o.plantaHashSha256,
      tamanhoBytes: o.plantaTamanhoBytes,
      atualizadaEm: o.plantaAtualizadaEm,
    };
  }
}
