import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cifrarUrlStream, decifrarUrlStream } from './camera-stream.crypto.js';
import {
  analisarChave,
  calcularHash,
  conferirHash,
  gerarCredencial,
} from './credencial-dispositivo.util.js';

describe('camera-stream.crypto', () => {
  const chave = randomBytes(32).toString('base64');

  it('cifra e decifra de volta ao texto original', () => {
    const original = 'rtsp://admin:senha-forte@10.0.0.5:554/stream1';
    const envelope = cifrarUrlStream(original, chave);

    expect(envelope.startsWith('enc:v1:')).toBe(true);
    expect(envelope).not.toContain(original);
    expect(decifrarUrlStream(envelope, chave)).toBe(original);
  });

  it('rejeita chave que nao tem 32 bytes', () => {
    expect(() => cifrarUrlStream('x', Buffer.from('curta').toString('base64'))).toThrow();
  });

  it('a tag de autenticacao detecta adulteracao do ciphertext', () => {
    const envelope = cifrarUrlStream('rtsp://x', chave);
    const partes = envelope.split(':');
    // Embaralha um byte do ciphertext sem tocar no formato do envelope.
    const ctAdulterado = Buffer.from(partes[4], 'base64');
    ctAdulterado[0] = ctAdulterado[0] ^ 0xff;
    const adulterado = [...partes.slice(0, 4), ctAdulterado.toString('base64')].join(':');

    expect(() => decifrarUrlStream(adulterado, chave)).toThrow();
  });

  it('duas cifragens da mesma string produzem envelopes diferentes (IV aleatorio)', () => {
    const a = cifrarUrlStream('rtsp://mesma-url', chave);
    const b = cifrarUrlStream('rtsp://mesma-url', chave);
    expect(a).not.toBe(b);
  });
});

describe('credencial-dispositivo.util', () => {
  const pepper = 'pepper-de-teste-bem-longo-o-suficiente';

  it('gera uma chave no formato pcr_<prefixo>_<segredo> e o hash confere', () => {
    const cred = gerarCredencial(pepper);

    expect(cred.chave).toBe(`pcr_${cred.prefixo}_${cred.segredo}`);
    expect(cred.prefixo).toHaveLength(12);
    expect(conferirHash(cred.segredo, pepper, cred.hashSecreto)).toBe(true);
  });

  it('duas gerações nunca colidem em prefixo nem em segredo', () => {
    const a = gerarCredencial(pepper);
    const b = gerarCredencial(pepper);
    expect(a.prefixo).not.toBe(b.prefixo);
    expect(a.segredo).not.toBe(b.segredo);
  });

  it('analisarChave separa prefixo e segredo de uma chave valida', () => {
    const cred = gerarCredencial(pepper);
    expect(analisarChave(cred.chave)).toEqual({ prefixo: cred.prefixo, segredo: cred.segredo });
  });

  it('analisarChave rejeita formato sem o prefixo pcr_', () => {
    expect(analisarChave('bearer_abc_def')).toBeNull();
    expect(analisarChave('pcr_semSegredoENemUnderscore')).toBeNull();
    expect(analisarChave('')).toBeNull();
  });

  it('conferirHash rejeita segredo errado', () => {
    const cred = gerarCredencial(pepper);
    expect(conferirHash('segredo-forjado', pepper, cred.hashSecreto)).toBe(false);
  });

  it('conferirHash rejeita pepper errado (hash calculado com outro pepper)', () => {
    const cred = gerarCredencial(pepper);
    expect(conferirHash(cred.segredo, 'pepper-errado-mas-tambem-longo', cred.hashSecreto)).toBe(
      false,
    );
  });

  it('conferirHash nao lanca quando o hash armazenado tem tamanho inesperado', () => {
    expect(() => conferirHash('segredo', pepper, 'hash-curto')).not.toThrow();
    expect(conferirHash('segredo', pepper, 'hash-curto')).toBe(false);
  });

  it('calcularHash e deterministico para o mesmo par segredo/pepper', () => {
    expect(calcularHash('s', pepper)).toBe(calcularHash('s', pepper));
  });
});
