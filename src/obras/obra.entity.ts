import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { NOME_ENUM, StatusObra } from '../shared/enums/dominio.enums.js';

@Entity('obra')
@Check('ck_obra_datas', `fim_previsto IS NULL OR inicio_previsto IS NULL OR fim_previsto >= inicio_previsto`)
@Check('ck_obra_uf', `uf IS NULL OR uf ~ '^[A-Z]{2}$'`)
export class Obra {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Vira UNIQUE (empresa_id, codigo) quando entrar multi-tenant. */
  @Index('ux_obra_codigo', { unique: true })
  @Column({ type: 'text' })
  codigo!: string;

  @Column({ type: 'text' })
  nome!: string;

  @Column({ type: 'text', nullable: true })
  endereco!: string | null;

  @Column({ type: 'text', nullable: true })
  cidade!: string | null;

  @Column({ type: 'char', length: 2, nullable: true })
  uf!: string | null;

  @Column({
    type: 'enum',
    enum: StatusObra,
    enumName: NOME_ENUM.statusObra,
    default: StatusObra.EM_ANDAMENTO,
  })
  status!: StatusObra;

  @Index('ix_obra_responsavel')
  @Column({ type: 'uuid', name: 'responsavel_tecnico_id', nullable: true })
  responsavelTecnicoId!: string | null;

  @Column({ type: 'date', name: 'inicio_previsto', nullable: true })
  inicioPrevisto!: string | null;

  @Column({ type: 'date', name: 'fim_previsto', nullable: true })
  fimPrevisto!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'criado_em' })
  criadoEm!: Date;
}
