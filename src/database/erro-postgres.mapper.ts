import { ConflitoError } from '../shared/erros/conflito.error.js';
import { ErroDominio } from '../shared/erros/erro-dominio.js';
import { RegraNegocioError } from '../shared/erros/regra-negocio.error.js';

/** SQLSTATE que nos interessam. */
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
// ON DELETE RESTRICT levanta 23001, e nao 23503: o Postgres distingue a
// violacao imediata do RESTRICT da violacao de FK adiada do NO ACTION.
const RESTRICT_VIOLATION = '23001';
const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';
const FEATURE_NOT_SUPPORTED = '0A000'; // usado pelos nossos triggers de imutabilidade
const INVALID_TEXT_REPRESENTATION = '22P02';

interface ErroPostgres {
  code: string;
  constraint?: string;
  detail?: string;
  table?: string;
  column?: string;
  message?: string;
}

/**
 * Traducao de nome de constraint para mensagem util. Sem isto, toda
 * invariante que mora no banco vira "erro interno" na tela — o que
 * transformaria a estrategia de CHECK/TRIGGER numa piora de DX.
 */
const MENSAGEM_POR_CONSTRAINT: Record<string, { codigo: string; mensagem: string }> = {
  // --- unicidade ---
  usuario_email_lower_uk: {
    codigo: 'EMAIL_JA_CADASTRADO',
    mensagem: 'Ja existe um usuario com esse e-mail.',
  },
  nao_conformidade_deteccao_id_key: {
    codigo: 'DETECCAO_JA_TEM_NC',
    mensagem:
      'Essa deteccao ja gerou uma nao conformidade. Uma deteccao gera no maximo uma NC.',
  },
  ux_nc_codigo: {
    codigo: 'CODIGO_NC_DUPLICADO',
    mensagem: 'Ja existe uma nao conformidade com esse codigo.',
  },
  ux_deteccao_camera_externo: {
    codigo: 'DETECCAO_DUPLICADA',
    mensagem: 'Essa deteccao ja foi registrada para esta camera (id_externo repetido).',
  },
  ux_acao_em_aberto_por_nc: {
    codigo: 'ACAO_CORRETIVA_JA_EM_ABERTO',
    mensagem:
      'Esta nao conformidade ja tem uma acao corretiva em aberto. Conclua a atual antes de criar outra.',
  },
  ux_verificacao_aprovada: {
    codigo: 'ACAO_JA_APROVADA',
    mensagem: 'Esta acao corretiva ja tem uma verificacao aprovada.',
  },

  // --- CHECK ---
  ck_usuario_crea: {
    codigo: 'CREA_SO_PARA_ENGENHEIRO',
    mensagem: 'O campo CREA so pode ser preenchido para usuarios com papel ENGENHEIRO.',
  },
  ck_deteccao_confianca: {
    codigo: 'CONFIANCA_FORA_DO_INTERVALO',
    mensagem: 'A confianca da deteccao precisa estar entre 0 e 1.',
  },
  ck_deteccao_triagem: {
    codigo: 'TRIAGEM_INCONSISTENTE',
    mensagem:
      'Deteccao triada exige quem triou e quando; deteccao PENDENTE nao pode ter esses campos.',
  },
  ck_modelo_limiar: {
    codigo: 'LIMIAR_FORA_DO_INTERVALO',
    mensagem: 'O limiar de confianca do modelo precisa estar entre 0 e 1.',
  },
  ck_nc_origem: {
    codigo: 'ORIGEM_NC_INCONSISTENTE',
    mensagem:
      'NC de origem IA exige uma deteccao vinculada; NC MANUAL nao pode ter deteccao vinculada.',
  },
  ck_nc_fechamento: {
    codigo: 'FECHAMENTO_NC_INCONSISTENTE',
    mensagem:
      'Data de fechamento e obrigatoria quando a NC esta RESOLVIDA ou CANCELADA, e proibida nos demais status.',
  },
  ck_nc_reincidencia: {
    codigo: 'REINCIDENCIA_INVALIDA',
    mensagem: 'Uma nao conformidade nao pode ser reincidencia dela mesma.',
  },
  ck_acao_datas: {
    codigo: 'DATAS_ACAO_INVALIDAS',
    mensagem: 'A conclusao da acao corretiva nao pode ser anterior ao seu inicio.',
  },
  ck_acao_custo: {
    codigo: 'CUSTO_INVALIDO',
    mensagem: 'O custo da acao corretiva nao pode ser negativo.',
  },
  ck_evidencia_vinculo: {
    codigo: 'EVIDENCIA_ORFA',
    mensagem:
      'Toda evidencia precisa apontar para ao menos uma deteccao, nao conformidade ou acao corretiva.',
  },
  ck_evidencia_hash: {
    codigo: 'HASH_INVALIDO',
    mensagem: 'O hash da evidencia precisa ser SHA-256 em 64 caracteres hexadecimais minusculos.',
  },
  ck_camera_stream_cifrado: {
    codigo: 'STREAM_NAO_CIFRADO',
    mensagem: 'A URL de stream da camera precisa ser gravada cifrada (prefixo enc:v1:).',
  },
};

function extrairErroPostgres(erro: unknown): ErroPostgres | null {
  if (typeof erro !== 'object' || erro === null) return null;

  // TypeORM embrulha o erro do driver em QueryFailedError.driverError.
  const candidato = (erro as { driverError?: unknown }).driverError ?? erro;
  if (typeof candidato !== 'object' || candidato === null) return null;

  const code = (candidato as { code?: unknown }).code;
  if (typeof code !== 'string') return null;

  return candidato as ErroPostgres;
}

/**
 * Converte um erro do Postgres em ErroDominio. Devolve `null` quando o
 * erro nao vem do banco — nesse caso o chamador deve deixar seguir.
 */
export function mapearErroPostgres(erro: unknown): ErroDominio | null {
  const pg = extrairErroPostgres(erro);
  if (!pg) return null;

  const conhecido = pg.constraint ? MENSAGEM_POR_CONSTRAINT[pg.constraint] : undefined;

  switch (pg.code) {
    case UNIQUE_VIOLATION:
      return new ConflitoError(
        conhecido?.codigo ?? 'RECURSO_DUPLICADO',
        conhecido?.mensagem ?? 'Ja existe um registro com esses dados.',
        { constraint: pg.constraint, detalhe: pg.detail },
      );

    case CHECK_VIOLATION:
      return new RegraNegocioError(
        conhecido?.codigo ?? 'REGRA_VIOLADA',
        // Triggers com RAISE usam 23514 e trazem a mensagem propria — ela e
        // mais especifica que qualquer coisa que possamos mapear por nome.
        conhecido?.mensagem ?? pg.message ?? 'Regra de negocio violada.',
        { constraint: pg.constraint },
      );

    case FOREIGN_KEY_VIOLATION:
      return new RegraNegocioError(
        'REFERENCIA_INVALIDA',
        'Um dos registros referenciados nao existe.',
        { constraint: pg.constraint, detalhe: pg.detail },
      );

    case RESTRICT_VIOLATION:
      // Acontece ao tentar apagar algo que sustenta prova (NC com evidencia,
      // acao com verificacao). E o comportamento desejado, nao um defeito.
      return new ConflitoError(
        'POSSUI_DEPENDENTES',
        'Este registro nao pode ser removido porque outros registros dependem dele. ' +
          'Cancele ou desative em vez de apagar.',
        { constraint: pg.constraint, detalhe: pg.detail },
      );

    case NOT_NULL_VIOLATION:
      return new RegraNegocioError(
        'CAMPO_OBRIGATORIO',
        `O campo "${pg.column ?? 'desconhecido'}" e obrigatorio.`,
        { coluna: pg.column, tabela: pg.table },
      );

    case FEATURE_NOT_SUPPORTED:
      // Nossos triggers de cadeia de custodia levantam 0A000 ao tentar
      // alterar/remover evidencia ou verificacao.
      return new ConflitoError(
        'REGISTRO_IMUTAVEL',
        pg.message ?? 'Este registro faz parte da cadeia de custodia e nao pode ser alterado.',
        { tabela: pg.table },
      );

    case INVALID_TEXT_REPRESENTATION:
      return new RegraNegocioError('FORMATO_INVALIDO', 'Um dos valores enviados tem formato invalido.');

    default:
      return null;
  }
}
