import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { NOME_ENUM, OrigemRegistro, TipoEvidencia } from '../shared/enums/dominio.enums.js';

/**
 * A prova, com cadeia de custodia. hash_sha256, uri, tipo, origem e
 * capturado_em sao imutaveis apos a insercao, e a linha nunca e deletada
 * (trigger com ERRCODE 0A000).
 *
 * `criado_em` e `tamanho_bytes`/`mime` nao estao no DBML e sao necessarios:
 * sem criado_em, uma foto de ontem enviada hoje e indistinguivel de uma foto
 * de ontem enviada ontem — que e exatamente a pergunta de um auditor.
 */
@Entity('evidencia')
@Index('ix_evidencia_nc', ['naoConformidadeId'])
@Index('ix_evidencia_deteccao', ['deteccaoId'])
@Index('ix_evidencia_acao', ['acaoCorretivaId'])
@Index('ix_evidencia_hash', ['hashSha256'])
// Nada de evidencia orfa: precisa apontar para ao menos um dos tres.
@Check(
  'ck_evidencia_vinculo',
  'num_nonnulls(deteccao_id, nao_conformidade_id, acao_corretiva_id) >= 1',
)
@Check('ck_evidencia_hash', `hash_sha256 ~ '^[0-9a-f]{64}$'`)
// Evidencia MANUAL exige autor humano; evidencia IA foi a camera (autor nulo).
@Check(
  'ck_evidencia_origem_autor',
  `(origem = 'MANUAL' AND autor_id IS NOT NULL) OR (origem = 'IA' AND autor_id IS NULL)`,
)
@Check('ck_evidencia_tamanho', 'tamanho_bytes IS NULL OR tamanho_bytes > 0')
export class Evidencia {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: TipoEvidencia, enumName: NOME_ENUM.tipoEvidencia })
  tipo!: TipoEvidencia;

  /** Chave relativa no object storage. Nunca caminho absoluto nem URL publica. */
  @Column({ type: 'text' })
  uri!: string;

  @Column({ type: 'char', length: 64, name: 'hash_sha256' })
  hashSha256!: string;

  @Column({ type: 'enum', enum: OrigemRegistro, enumName: NOME_ENUM.origemRegistro })
  origem!: OrigemRegistro;

  @Column({ type: 'uuid', name: 'autor_id', nullable: true })
  autorId!: string | null;

  @Column({ type: 'uuid', name: 'deteccao_id', nullable: true })
  deteccaoId!: string | null;

  @Column({ type: 'uuid', name: 'nao_conformidade_id', nullable: true })
  naoConformidadeId!: string | null;

  @Column({ type: 'uuid', name: 'acao_corretiva_id', nullable: true })
  acaoCorretivaId!: string | null;

  /** Hora real da captura, informada pelo cliente. */
  @Column({ type: 'timestamptz', name: 'capturado_em', default: () => 'now()' })
  capturadoEm!: Date;

  /** Hora de recebimento no servidor. Diferente de capturado_em, de proposito. */
  @Column({ type: 'timestamptz', name: 'criado_em', default: () => 'now()' })
  criadoEm!: Date;

  @Column({ type: 'bigint', name: 'tamanho_bytes', nullable: true })
  tamanhoBytes!: string | null;

  @Column({ type: 'text', nullable: true })
  mime!: string | null;
}
