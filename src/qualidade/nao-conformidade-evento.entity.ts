import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { NOME_ENUM, StatusNc } from '../shared/enums/dominio.enums.js';

/**
 * Linha do tempo da NC. Escrita por TRIGGER, nunca pela aplicacao — para
 * que um UPDATE vindo de script tambem seja capturado. Append-only.
 */
@Entity('nao_conformidade_evento')
@Index('ix_nc_evento_nc', ['naoConformidadeId', 'ocorridoEm'])
export class NaoConformidadeEvento {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'nao_conformidade_id' })
  naoConformidadeId!: string;

  @Column({ type: 'enum', enum: StatusNc, enumName: NOME_ENUM.statusNc, nullable: true })
  de!: StatusNc | null;

  @Column({ type: 'enum', enum: StatusNc, enumName: NOME_ENUM.statusNc })
  para!: StatusNc;

  /** NULL quando a alteracao veio de seed, migration ou script. */
  @Column({ type: 'uuid', name: 'ator_id', nullable: true })
  atorId!: string | null;

  @Column({ type: 'text', nullable: true })
  motivo!: string | null;

  @Column({ type: 'timestamptz', name: 'ocorrido_em', default: () => 'now()' })
  ocorridoEm!: Date;
}
