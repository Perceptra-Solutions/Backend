import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { NOME_ENUM, PapelUsuario } from '../shared/enums/dominio.enums.js';

@Entity('usuario')
// O DBML manda: crea so preenchido quando papel = ENGENHEIRO.
@Check('ck_usuario_crea', `crea IS NULL OR papel = 'ENGENHEIRO'`)
export class Usuario {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  nome!: string;

  /**
   * A unicidade real e por lower(email) — o indice funcional esta na
   * migration. Um UNIQUE simples deixaria 'Ana@x.com' e 'ana@x.com'
   * conviverem, e o login acharia zero ou dois usuarios.
   */
  @Column({ type: 'text' })
  email!: string;

  /** Nunca sai em resposta: os repositorios usam select explicito. */
  @Column({ type: 'text', name: 'senha_hash', select: false })
  senhaHash!: string;

  @Index('ix_usuario_papel')
  @Column({ type: 'enum', enum: PapelUsuario, enumName: NOME_ENUM.papelUsuario })
  papel!: PapelUsuario;

  @Column({ type: 'text', nullable: true })
  crea!: string | null;

  @Column({ type: 'boolean', default: true })
  ativo!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'criado_em' })
  criadoEm!: Date;

  ehEngenheiro(): boolean {
    return this.papel === PapelUsuario.ENGENHEIRO;
  }
}
