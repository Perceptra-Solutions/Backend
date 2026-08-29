/**
 * Os 11 enums do MER. Este arquivo e FOLHA: nao importa nada, entao nunca
 * participa de ciclo de importacao — o que importa sob ESM, onde ciclo com
 * decorator vira TDZ ("Cannot access X before initialization").
 *
 * O nome do tipo no Postgres e o snake_case do DBML; ele viaja no
 * `enumName` de cada @Column para o tipo nascer com o nome certo.
 */

export enum PapelUsuario {
  GESTOR = 'GESTOR',
  ENGENHEIRO = 'ENGENHEIRO',
}

export enum StatusObra {
  PLANEJAMENTO = 'PLANEJAMENTO',
  EM_ANDAMENTO = 'EM_ANDAMENTO',
  PARALISADA = 'PARALISADA',
  CONCLUIDA = 'CONCLUIDA',
}

export enum TipoLocal {
  BLOCO = 'BLOCO',
  PAVIMENTO = 'PAVIMENTO',
  UNIDADE = 'UNIDADE',
  AMBIENTE = 'AMBIENTE',
  AREA_COMUM = 'AREA_COMUM',
  EXTERNO = 'EXTERNO',
}

export enum StatusCamera {
  ATIVA = 'ATIVA',
  OFFLINE = 'OFFLINE',
  MANUTENCAO = 'MANUTENCAO',
}

export enum StatusTriagem {
  PENDENTE = 'PENDENTE',
  CONFIRMADA = 'CONFIRMADA',
  FALSO_POSITIVO = 'FALSO_POSITIVO',
  DUPLICADA = 'DUPLICADA',
}

export enum TipoEvidencia {
  FOTO = 'FOTO',
  VIDEO = 'VIDEO',
  DOCUMENTO = 'DOCUMENTO',
}

export enum OrigemRegistro {
  IA = 'IA',
  MANUAL = 'MANUAL',
}

export enum CategoriaDesempenho {
  TERMICO = 'TERMICO',
  ACUSTICO = 'ACUSTICO',
  ESTANQUEIDADE = 'ESTANQUEIDADE',
  ESTRUTURAL = 'ESTRUTURAL',
  SEGURANCA_FOGO = 'SEGURANCA_FOGO',
  DURABILIDADE = 'DURABILIDADE',
  OUTRO = 'OUTRO',
}

export enum SeveridadeNc {
  BAIXA = 'BAIXA',
  MEDIA = 'MEDIA',
  ALTA = 'ALTA',
  CRITICA = 'CRITICA',
}

export enum StatusNc {
  ABERTA = 'ABERTA',
  EM_CORRECAO = 'EM_CORRECAO',
  AGUARDANDO_VERIFICACAO = 'AGUARDANDO_VERIFICACAO',
  RESOLVIDA = 'RESOLVIDA',
  CANCELADA = 'CANCELADA',
}

export enum ResultadoVerificacao {
  APROVADA = 'APROVADA',
  REPROVADA = 'REPROVADA',
}

export enum TipoRelatorio {
  NAO_CONFORMIDADE = 'NAO_CONFORMIDADE',
  PERIODICO = 'PERIODICO',
  OBRA = 'OBRA',
}

/** Nomes dos tipos enum no Postgres — usados no `enumName` das colunas. */
export const NOME_ENUM = {
  papelUsuario: 'papel_usuario',
  statusObra: 'status_obra',
  tipoLocal: 'tipo_local',
  statusCamera: 'status_camera',
  statusTriagem: 'status_triagem',
  tipoEvidencia: 'tipo_evidencia',
  origemRegistro: 'origem_registro',
  categoriaDesempenho: 'categoria_desempenho',
  severidadeNc: 'severidade_nc',
  statusNc: 'status_nc',
  resultadoVerificacao: 'resultado_verificacao',
  tipoRelatorio: 'tipo_relatorio',
} as const;
