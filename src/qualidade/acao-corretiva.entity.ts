import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('acao_corretiva')
@Index('ix_acao_nc', ['naoConformidadeId'])
@Index('ix_acao_executor', ['executorId'])
// Uma NC tem no maximo UMA acao em aberto por vez; as anteriores ficam como
// historico. E o indice parcial que permite o retorno da verificacao
// REPROVADA criar uma acao nova sem conflitar com a reprovada.
@Index('ux_acao_em_aberto_por_nc', ['naoConformidadeId'], {
  unique: true,
  where: 'concluida_em IS NULL',
})
@Check('ck_acao_datas', 'concluida_em IS NULL OR concluida_em >= iniciada_em')
@Check('ck_acao_custo', 'custo IS NULL OR custo >= 0')
export class AcaoCorretiva {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'nao_conformidade_id' })
  naoConformidadeId!: string;

  /**
   * NOT NULL, ao contrario do DBML: uma acao corretiva so nasce quando
   * alguem a assume. Sem dono, a segregacao de funcao na verificacao nao
   * tem contra quem comparar.
   */
  @Column({ type: 'uuid', name: 'executor_id' })
  executorId!: string;

  @Column({ type: 'text' })
  descricao!: string;

  @Column({ type: 'text', name: 'causa_raiz', nullable: true })
  causaRaiz!: string | null;

  /** Planejamento do executor; validado contra o prazo (SLA) da NC. */
  @Column({ type: 'date', nullable: true })
  prazo!: string | null;

  @Column({ type: 'timestamptz', name: 'iniciada_em', default: () => 'now()' })
  iniciadaEm!: Date;

  @Column({ type: 'timestamptz', name: 'concluida_em', nullable: true })
  concluidaEm!: Date | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: {
      to: (v: number | null) => v ?? null,
      from: (v: string | null) => (v === null ? null : Number(v)),
    },
  })
  custo!: number | null;

  estaConcluida(): boolean {
    return this.concluidaEm !== null;
  }
}
