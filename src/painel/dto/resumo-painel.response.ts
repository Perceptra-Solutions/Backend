import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { SeveridadeNc } from '../../shared/enums/dominio.enums.js';

export class NcsPorSeveridadeItem {
  @ApiProperty() severidade!: SeveridadeNc;
  @ApiProperty() total!: number;
}

export class NcsPorCategoriaItem {
  @ApiProperty({
    description: 'Categoria do requisito de norma da NC, ou NAO_CLASSIFICADA quando a NC nao tem requisito vinculado.',
  })
  categoria!: string;
  @ApiProperty() total!: number;
}

export class FalsoPositivoPorModeloItem {
  @ApiProperty() modeloId!: string;
  @ApiProperty() modeloNome!: string;
  @ApiProperty() modeloVersao!: string;
  @ApiProperty({ description: 'Deteccoes ja triadas (exclui PENDENTE).' }) totalTriado!: number;
  @ApiProperty() falsosPositivos!: number;
  @ApiProperty({ description: 'falsosPositivos / totalTriado, 0 quando nao ha triagem.' }) taxa!: number;
}

export class SaudeFrotaResponse {
  @ApiProperty() total!: number;
  @ApiProperty() ativas!: number;
  @ApiProperty() offline!: number;
  @ApiProperty() manutencao!: number;
}

/**
 * Todos os cards do painel numa unica resposta — GET /painel/resumo devolve
 * isto pronto para renderizar, sem o front precisar de N requisicoes.
 *
 * Duas regras valem para todo indicador aqui (ver ANDAMENTO.md secao 5):
 * NC CANCELADA nunca entra na contagem (senao da para maquiar indicador
 * cancelando NC), e NC sem requisito_norma_id vira um bucket NAO_CLASSIFICADA
 * em vez de sumir da contagem por categoria.
 */
export class ResumoPainelResponse {
  @ApiPropertyOptional({ nullable: true, description: 'null quando o resumo cobre todas as obras.' })
  obraId!: string | null;

  @ApiProperty({ type: [NcsPorSeveridadeItem] })
  ncsAbertasPorSeveridade!: NcsPorSeveridadeItem[];

  @ApiProperty({ type: [NcsPorCategoriaItem] })
  ncsAbertasPorCategoria!: NcsPorCategoriaItem[];

  @ApiProperty({ description: 'NCs nao terminais com prazo < agora.' })
  ncsComPrazoVencido!: number;

  @ApiPropertyOptional({ nullable: true, description: 'Media de horas entre aberta_em e fechada_em das NCs RESOLVIDA. null sem nenhuma resolvida.' })
  tempoMedioFechamentoHoras!: number | null;

  @ApiProperty({ description: 'Fracao (0..1) de NCs nao-CANCELADA que sao reincidencia de outra.' })
  taxaReincidencia!: number;

  @ApiProperty({ type: [FalsoPositivoPorModeloItem] })
  falsoPositivoPorModelo!: FalsoPositivoPorModeloItem[];

  @ApiProperty()
  saudeDaFrota!: SaudeFrotaResponse;
}
