import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { NOME_ENUM, TipoLocal } from '../shared/enums/dominio.enums.js';

/**
 * Achatado de proposito na POC: sem auto-relacionamento. O caminho legivel
 * ("Torre B / 7 pav / apto 703 / banheiro") vai no nome.
 */
@Entity('local')
@Index('ux_local_obra_codigo', ['obraId', 'codigo'], {
  unique: true,
  where: 'codigo IS NOT NULL',
})
@Index('ix_local_obra', ['obraId'])
export class Local {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'obra_id' })
  obraId!: string;

  @Column({ type: 'enum', enum: TipoLocal, enumName: NOME_ENUM.tipoLocal })
  tipo!: TipoLocal;

  @Column({ type: 'text' })
  nome!: string;

  @Column({ type: 'text', nullable: true })
  codigo!: string | null;
}
