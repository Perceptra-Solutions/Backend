import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { CategoriaDesempenho, NOME_ENUM } from '../shared/enums/dominio.enums.js';

/**
 * Tabela de dominio, populada por seed. E o que transforma "achamos 8
 * problemas" em "8 NCs, 5 de estanqueidade" — base do painel de conformidade.
 */
@Entity('requisito_norma')
@Index('ux_requisito_norma_item', ['norma', 'item'], { unique: true })
export class RequisitoNorma {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** NBR 15575 | PBQP-H */
  @Column({ type: 'text' })
  norma!: string;

  /** ex: Parte 3 - 11.2 */
  @Column({ type: 'text' })
  item!: string;

  @Index('ix_requisito_categoria')
  @Column({
    type: 'enum',
    enum: CategoriaDesempenho,
    enumName: NOME_ENUM.categoriaDesempenho,
  })
  categoria!: CategoriaDesempenho;

  @Column({ type: 'text' })
  descricao!: string;
}
