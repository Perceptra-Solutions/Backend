import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { NOME_ENUM, ResultadoVerificacao } from '../shared/enums/dominio.enums.js';

/**
 * Laudo assinado: append-only. Nunca sofre UPDATE nem DELETE — ha trigger
 * garantindo (ERRCODE 0A000).
 *
 * O invariante que da nome ao desafio mora aqui: quem executou a acao
 * corretiva nao pode verifica-la. Isso e trigger no banco E politica de
 * dominio na aplicacao — o banco e a rede de seguranca, a aplicacao da a
 * mensagem util.
 */
@Entity('verificacao')
@Index('ix_verificacao_acao', ['acaoCorretivaId'])
// No maximo uma APROVADA por acao; reprovacoes anteriores continuam no historico.
@Index('ux_verificacao_aprovada', ['acaoCorretivaId'], {
  unique: true,
  where: `resultado = 'APROVADA'`,
})
export class Verificacao {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'acao_corretiva_id' })
  acaoCorretivaId!: string;

  @Column({ type: 'uuid', name: 'verificado_por' })
  verificadoPor!: string;

  @Column({
    type: 'enum',
    enum: ResultadoVerificacao,
    enumName: NOME_ENUM.resultadoVerificacao,
  })
  resultado!: ResultadoVerificacao;

  /** Obrigatorio quando REPROVADA (validado na aplicacao). */
  @Column({ type: 'text', nullable: true })
  parecer!: string | null;

  @Column({ type: 'timestamptz', name: 'verificado_em', default: () => 'now()' })
  verificadoEm!: Date;
}
