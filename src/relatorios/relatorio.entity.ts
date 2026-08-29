import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { NOME_ENUM, TipoRelatorio } from '../shared/enums/dominio.enums.js';

@Entity('relatorio')
@Index('ix_relatorio_obra', ['obraId'])
@Check(
  'ck_relatorio_periodo',
  `(periodo_inicio IS NULL AND periodo_fim IS NULL) OR (periodo_inicio IS NOT NULL AND periodo_fim IS NOT NULL AND periodo_fim >= periodo_inicio)`,
)
@Check(
  'ck_relatorio_periodico_exige_periodo',
  `tipo <> 'PERIODICO' OR (periodo_inicio IS NOT NULL AND periodo_fim IS NOT NULL)`,
)
@Check('ck_relatorio_hash', `hash_sha256 IS NULL OR hash_sha256 ~ '^[0-9a-f]{64}$'`)
export class Relatorio {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'obra_id' })
  obraId!: string;

  @Column({ type: 'uuid', name: 'gerado_por', nullable: true })
  geradoPor!: string | null;

  @Column({ type: 'enum', enum: TipoRelatorio, enumName: NOME_ENUM.tipoRelatorio })
  tipo!: TipoRelatorio;

  @Column({ type: 'text' })
  titulo!: string;

  @Column({ type: 'date', name: 'periodo_inicio', nullable: true })
  periodoInicio!: string | null;

  @Column({ type: 'date', name: 'periodo_fim', nullable: true })
  periodoFim!: string | null;

  @Column({ type: 'text', name: 'arquivo_uri', nullable: true })
  arquivoUri!: string | null;

  @Column({ type: 'char', length: 64, name: 'hash_sha256', nullable: true })
  hashSha256!: string | null;

  @Column({ type: 'timestamptz', name: 'gerado_em', default: () => 'now()' })
  geradoEm!: Date;
}
