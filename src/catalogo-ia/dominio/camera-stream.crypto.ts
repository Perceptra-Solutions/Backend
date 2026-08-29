import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM para `camera.url_stream`. O DBML manda nunca gravar essa
 * coluna em texto plano — ela carrega usuario:senha do RTSP. O CHECK
 * `ck_camera_stream_cifrado` ja exige o prefixo `enc:v1:`; este arquivo e
 * quem de fato cifra.
 *
 * Envelope: `enc:v1:<iv base64>:<tag base64>:<ciphertext base64>`.
 * GCM em vez de CBC: autentica o conteudo (a tag detecta adulteracao) sem
 * precisar de um HMAC separado.
 */

const VERSAO = 'v1';
const ALGORITMO = 'aes-256-gcm';
const TAMANHO_IV = 12; // recomendado para GCM — 16 exigiria custom AAD handling

function chaveComoBuffer(chaveBase64: string): Buffer {
  const chave = Buffer.from(chaveBase64, 'base64');
  if (chave.length !== 32) {
    throw new Error(
      `CAMERA_URL_STREAM_ENC_KEY precisa decodificar para 32 bytes (AES-256); recebeu ${chave.length}.`,
    );
  }
  return chave;
}

export function cifrarUrlStream(textoPlano: string, chaveBase64: string): string {
  const chave = chaveComoBuffer(chaveBase64);
  const iv = randomBytes(TAMANHO_IV);
  const cipher = createCipheriv(ALGORITMO, chave, iv);
  const ct = Buffer.concat([cipher.update(textoPlano, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${VERSAO}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decifrarUrlStream(envelope: string, chaveBase64: string): string {
  const partes = envelope.split(':');
  if (partes.length !== 5 || partes[0] !== 'enc' || partes[1] !== VERSAO) {
    throw new Error('Envelope de url_stream em formato inesperado (esperado enc:v1:...).');
  }
  const [, , ivB64, tagB64, ctB64] = partes;
  const chave = chaveComoBuffer(chaveBase64);
  const decipher = createDecipheriv(ALGORITMO, chave, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const texto = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
  return texto.toString('utf8');
}
