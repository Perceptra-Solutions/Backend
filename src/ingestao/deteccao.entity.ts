import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { NOME_ENUM, StatusTriagem } from '../shared/enums/dominio.enums.js';
import { numericoTransformer } from '../shared/util/numerico.transformer.js';

/**
 * Evento bruto da IA. Tabela de maior volume do sistema: 12 cameras a 2
 * deteccoes/min dao ~35 mil linhas/dia.
 *
 * Duas colunas nao estao no DBML e sao essenciais ao produto:
 *  - `obra_id` denormalizada: permite o indice da fila de triagem por obra
 *    e a checagem de coerencia camera/obra sem join.
 *  - `id_externo`: chave natural do agente na borda. A camera Perceptra One
 *    opera OFFLINE e despeja o buffer ao reconectar; sem esta coluna a mesma
 *    trinca e contada de novo a cada reconexao e o painel mente.
 */
@Entity('deteccao')
@Index('ix_deteccao_camera_ocorrido', ['cameraId', 'ocorridoEm'])
@Index('ux_deteccao_camera_externo', ['cameraId', 'idExterno'], {
  unique: true,
  where: 'id_externo IS NOT NULL',
})
@Check('ck_deteccao_confianca', 'confianca >= 0 AND confianca <= 1')
@Check(
  'ck_deteccao_triagem',
  `(status_triagem = 'PENDENTE') = (triado_por IS NULL AND triado_em IS NULL)`,
)
@Check('ck_deteccao_duplicada', 'duplicada_de_id IS DISTINCT FROM id')
@Check(
  'ck_deteccao_duplicada_status',
  `status_triagem = 'DUPLICADA' OR duplicada_de_id IS NULL`,
)
export class Deteccao {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'camera_id' })
  cameraId!: string;

  /** Denormalizada da camera por trigger BEFORE INSERT; imutavel. */
  @Column({ type: 'uuid', name: 'obra_id' })
  obraId!: string;

  @Column({ type: 'uuid', name: 'modelo_ia_id' })
  modeloIaId!: string;

  /** Id local do agente na borda — chave de deduplicacao. */
  @Column({ type: 'text', name: 'id_externo', nullable: true })
  idExterno!: string | null;

  @Column({ type: 'text' })
  classe!: string;

  @Column({
    type: 'numeric',
    precision: 4,
    scale: 3,
    transformer: numericoTransformer,
  })
  confianca!: number;

  @Column({ type: 'jsonb', nullable: true })
  bbox!: Record<string, unknown> | null;

  /** Hora do evento na obra, informada pela camera (nao a de recebimento). */
  @Column({ type: 'timestamptz', name: 'ocorrido_em' })
  ocorridoEm!: Date;

  @Column({ type: 'timestamptz', name: 'recebido_em', default: () => 'now()' })
  recebidoEm!: Date;

  @Column({
    type: 'enum',
    enum: StatusTriagem,
    enumName: NOME_ENUM.statusTriagem,
    name: 'status_triagem',
    default: StatusTriagem.PENDENTE,
  })
  statusTriagem!: StatusTriagem;

  @Column({ type: 'uuid', name: 'triado_por', nullable: true })
  triadoPor!: string | null;

  @Column({ type: 'timestamptz', name: 'triado_em', nullable: true })
  triadoEm!: Date | null;

  /** Preenchida quando status_triagem = DUPLICADA: aponta para a original. */
  @Column({ type: 'uuid', name: 'duplicada_de_id', nullable: true })
  duplicadaDeId!: string | null;
}
