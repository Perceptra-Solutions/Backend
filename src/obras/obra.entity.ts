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

  /**
   * Planta / mapa do canteiro (migration `1756400004000-PlantaDaObra`).
   *
   * Mesmo padrão da evidência: o binário vive no storage
   * (`ArmazenamentoPort`) e aqui ficam só a chave e o metadado. Diferente da
   * evidência, é cadastro e não prova — pode ser substituída, e o CHECK
   * `ck_obra_planta_completa` garante que os campos andem sempre juntos.
   *
   * `select: false` na URI: é caminho interno do bucket e nunca deve sair
   * numa resposta de API por descuido — o download tem rota própria.
   */
  @Column({ type: 'text', name: 'planta_uri', nullable: true, select: false })
  plantaUri!: string | null;

  @Column({ type: 'text', name: 'planta_nome', nullable: true })
  plantaNome!: string | null;

  @Column({ type: 'text', name: 'planta_mime', nullable: true })
  plantaMime!: string | null;

  @Column({ type: 'char', length: 64, name: 'planta_hash_sha256', nullable: true })
  plantaHashSha256!: string | null;

  @Column({ type: 'bigint', name: 'planta_tamanho_bytes', nullable: true })
  plantaTamanhoBytes!: string | null;

  @Column({ type: 'timestamptz', name: 'planta_atualizada_em', nullable: true })
  plantaAtualizadaEm!: Date | null;
}
