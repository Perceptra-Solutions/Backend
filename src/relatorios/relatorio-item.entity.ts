import { Check, Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('relatorio_item')
@Index('ix_relatorio_item_nc', ['naoConformidadeId'])
@Index('ux_relatorio_item_ordem', ['relatorioId', 'ordem'], { unique: true })
@Check('ck_relatorio_item_ordem', 'ordem > 0')
export class RelatorioItem {
  @PrimaryColumn({ type: 'uuid', name: 'relatorio_id' })
  relatorioId!: string;

  @PrimaryColumn({ type: 'uuid', name: 'nao_conformidade_id' })
  naoConformidadeId!: string;

  @Column({ type: 'int', default: 1 })
  ordem!: number;
}
