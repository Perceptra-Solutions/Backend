import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  NOME_ENUM,
  OrigemRegistro,
  SeveridadeNc,
  StatusNc,
} from '../shared/enums/dominio.enums.js';

/**
 * A entidade central. Sem ela nao existe painel, prazo, responsavel nem
 * indicador — e o desafio vira um CRUD com tema de obra.
 *
 * `prazo` e timestamptz e nao date (como no DBML) porque a regra de
 * severidade CRITICA e de 24 HORAS: um campo date nao consegue expressa-la.
 * Este e o SLA contratual, o UNICO usado no indicador de atraso; o prazo da
 * acao corretiva e planejamento interno do executor.
 */
@Entity('nao_conformidade')
@Index('ix_nc_obra_status', ['obraId', 'status'])
@Index('ix_nc_responsavel', ['responsavelId'])
@Index('ix_nc_requisito', ['requisitoNormaId'])
@Index('ix_nc_reincidencia', ['reincidenciaDeId'])
@Check(
  'ck_nc_origem',
  `(origem = 'IA' AND deteccao_id IS NOT NULL) OR (origem = 'MANUAL' AND deteccao_id IS NULL)`,
)
@Check(
  'ck_nc_fechamento',
  `(status IN ('RESOLVIDA','CANCELADA')) = (fechada_em IS NOT NULL)`,
)
@Check('ck_nc_fechada_apos_abertura', 'fechada_em IS NULL OR fechada_em >= aberta_em')
@Check('ck_nc_reincidencia', 'reincidencia_de_id IS DISTINCT FROM id')
export class NaoConformidade {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'obra_id' })
  obraId!: string;

  @Column({ type: 'uuid', name: 'local_id', nullable: true })
  localId!: string | null;

  /** UNIQUE: uma deteccao gera no maximo uma NC. */
  @Index('ux_nc_deteccao', { unique: true })
  @Column({ type: 'uuid', name: 'deteccao_id', nullable: true })
  deteccaoId!: string | null;

  @Column({ type: 'uuid', name: 'requisito_norma_id', nullable: true })
  requisitoNormaId!: string | null;

  @Column({ type: 'uuid', name: 'responsavel_id', nullable: true })
  responsavelId!: string | null;

  @Column({ type: 'uuid', name: 'reincidencia_de_id', nullable: true })
  reincidenciaDeId!: string | null;

  /** NC-AAAA-NNNNNN, gerado por trigger com SEQUENCE. Imutavel. */
  @Index('ux_nc_codigo', { unique: true })
  @Column({ type: 'text' })
  codigo!: string;

  @Column({ type: 'enum', enum: OrigemRegistro, enumName: NOME_ENUM.origemRegistro })
  origem!: OrigemRegistro;

  @Column({ type: 'text' })
  titulo!: string;

  @Column({ type: 'text', nullable: true })
  descricao!: string | null;

  @Column({ type: 'enum', enum: SeveridadeNc, enumName: NOME_ENUM.severidadeNc })
  severidade!: SeveridadeNc;

  @Column({
    type: 'enum',
    enum: StatusNc,
    enumName: NOME_ENUM.statusNc,
    default: StatusNc.ABERTA,
  })
  status!: StatusNc;

  /** SLA derivado da severidade a partir de aberta_em. */
  @Column({ type: 'timestamptz', nullable: true })
  prazo!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'aberta_em' })
  abertaEm!: Date;

  @Column({ type: 'timestamptz', name: 'fechada_em', nullable: true })
  fechadaEm!: Date | null;

  /** "Atrasada" NAO e status: e derivado, e muda sozinho com o relogio. */
  estaAtrasada(agora: Date = new Date()): boolean {
    if (this.status === StatusNc.RESOLVIDA || this.status === StatusNc.CANCELADA) return false;
    return this.prazo !== null && this.prazo < agora;
  }
}
