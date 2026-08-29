import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';

/**
 * Geracao e conferencia da credencial de dispositivo. Puro: sem Nest, sem
 * TypeORM, sem I/O — testavel em milissegundos, como o resto de dominio/.
 *
 * Formato da chave: `pcr_<prefixo>_<segredo>`.
 *   - prefixo: 12 hex (6 bytes), indexado em UNIQUE — e a chave de lookup
 *     O(1) da credencial, nunca secreto por si so.
 *   - segredo: 32 bytes em base64url — e o que prova posse da credencial.
 *
 * So o HASH do segredo (com pepper) fica gravado. Um vazamento do banco
 * sozinho nao permite forjar credencial: falta o pepper, que vive so na
 * variavel de ambiente da API.
 *
 * SHA-256 e nao bcrypt/argon2 de proposito: o segredo ja tem 256 bits
 * aleatorios (nao e senha de humano, nao precisa de KDF lento) e o hash e
 * conferido a CADA requisicao de ingestao — um KDF lento aqui seria o
 * gargalo do pipeline, nao uma defesa a mais.
 */

const PREFIXO_CHAVE = 'pcr';

export interface CredencialGerada {
  prefixo: string;
  segredo: string;
  /** O token completo — mostrado ao usuario UMA vez, nunca persistido em texto puro. */
  chave: string;
  /** SHA-256(pepper + segredo) em hex — o que de fato vai para o banco. */
  hashSecreto: string;
}

export function gerarCredencial(pepper: string): CredencialGerada {
  const prefixo = randomBytes(6).toString('hex');
  const segredo = randomBytes(32).toString('base64url');
  const chave = `${PREFIXO_CHAVE}_${prefixo}_${segredo}`;
  return { prefixo, segredo, chave, hashSecreto: calcularHash(segredo, pepper) };
}

export function calcularHash(segredo: string, pepper: string): string {
  return createHash('sha256').update(pepper).update(segredo).digest('hex');
}

/**
 * Separa a chave recebida no header em (prefixo, segredo). Devolve `null`
 * quando o formato nao bate — o chamador trata como credencial invalida,
 * sem detalhar o motivo (a mensagem especifica so ajudaria quem sonda).
 *
 * Corta so nos DOIS primeiros `_`, nunca com `split('_')` ingenuo: o
 * alfabeto base64url usa `_` como caractere valido (62/63), entao o
 * segredo em si pode conter underscore no meio.
 */
export function analisarChave(chave: string): { prefixo: string; segredo: string } | null {
  if (!chave.startsWith(`${PREFIXO_CHAVE}_`)) return null;

  const resto = chave.slice(PREFIXO_CHAVE.length + 1);
  const separador = resto.indexOf('_');
  if (separador <= 0 || separador === resto.length - 1) return null;

  return { prefixo: resto.slice(0, separador), segredo: resto.slice(separador + 1) };
}

/**
 * Compara em tempo constante. `timingSafeEqual` exige buffers do MESMO
 * tamanho — hashes SHA-256 em hex sempre tem 64 chars, mas um valor
 * corrompido/vindo de outro esquema nao pode explodir aqui: devolve `false`
 * em vez de lancar.
 */
export function conferirHash(segredo: string, pepper: string, hashArmazenado: string): boolean {
  const calculado = Buffer.from(calcularHash(segredo, pepper), 'hex');
  const armazenado = Buffer.from(hashArmazenado, 'hex');
  if (calculado.length !== armazenado.length) return false;
  return timingSafeEqual(calculado, armazenado);
}
