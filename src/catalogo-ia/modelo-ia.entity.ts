import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { numericoTransformer } from '../shared/util/numerico.transformer.js';

/**
 * Funde modelo_ia + versao_modelo do modelo original. E o que da
 * rastreabilidade: toda deteccao aponta para a VERSAO exata que a produziu.
 *
 * Regra dura do DBML: nunca faca UPDATE numa versao publicada — cada versao
 * e uma linha nova. So `ativo` pode mudar (aposentadoria). Ha um trigger
 * garantindo isso na migration.
 */
@Entity('modelo_ia')
@Index('ux_modelo_nome_versao', ['nome', 'versao'], { unique: true })
@Check('ck_modelo_limiar', 'limiar_confianca >= 0 AND limiar_confianca <= 1')
export class ModeloIa {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  nome!: string;

  @Column({ type: 'text' })
  versao!: string;

  /** TRINCA | INFILTRACAO | EPI | ORGANIZACAO ... */
  @Column({ type: 'text', name: 'tipo_deteccao' })
  tipoDeteccao!: string;

  @Column({
    type: 'numeric',
    precision: 4,
    scale: 3,
    name: 'limiar_confianca',
    default: 0.7,
    transformer: numericoTransformer,
  })
  limiarConfianca!: number;

  /** precision / recall / mAP do treino */
  @Column({ type: 'jsonb', nullable: true })
  metricas!: Record<string, unknown> | null;

  @Column({ type: 'text', name: 'hash_artefato', nullable: true })
  hashArtefato!: string | null;

  @Column({ type: 'date', name: 'publicado_em', default: () => 'CURRENT_DATE' })
  publicadoEm!: string;

  @Column({ type: 'boolean', default: true })
  ativo!: boolean;
}
