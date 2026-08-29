import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RejeicaoIngestaoDto {
  @ApiProperty({ description: 'Posicao do item no array enviado (base 0).' })
  indice!: number;

  @ApiPropertyOptional()
  idExterno?: string;

  @ApiProperty({
    example: 'MODELO_NAO_ENCONTRADO',
    description: 'MODELO_NAO_ENCONTRADO | OCORRIDO_EM_FORA_DA_JANELA',
  })
  motivo!: string;
}

/**
 * 201 sempre, mesmo com rejeicoes parciais — nao 207. O lote como operacao
 * teve exito; cada item que nao entrou tem seu proprio motivo, para o
 * agente decidir se vale reenviar.
 */
export class ResultadoIngestaoResponse {
  @ApiProperty({ description: 'Gravadas com sucesso.' })
  aceitas!: number;

  @ApiProperty({ description: 'Descartadas por id_externo repetido — nao e erro.' })
  duplicadas!: number;

  @ApiProperty({
    description: 'confianca abaixo do limiar do modelo — descartada de proposito, nao gravada.',
  })
  descartadasPorLimiar!: number;

  @ApiProperty({ type: () => [RejeicaoIngestaoDto] })
  rejeitadas!: RejeicaoIngestaoDto[];
}
