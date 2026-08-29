import { ehFalhaDeCredencial, ehFalhaPermanente } from './sqs-consumidor.service.js';

/**
 * A fila `fila-resultados-web` nao tem DLQ (redrive desabilitado, ver
 * ARQUITETURA_AWS.md). Sem esta distincao, um `processed/*.json` apagado
 * deixa a mensagem correspondente em retry infinito.
 */
describe('ehFalhaPermanente', () => {
  it('trata NoSuchKey como permanente (GetObject de chave inexistente)', () => {
    expect(ehFalhaPermanente(Object.assign(new Error('nao existe'), { name: 'NoSuchKey' }))).toBe(true);
  });

  it('trata NotFound como permanente (objeto apagado depois da notificacao)', () => {
    expect(ehFalhaPermanente(Object.assign(new Error('sumiu'), { name: 'NotFound' }))).toBe(true);
  });

  it('trata 404 no $metadata como permanente, independente do name', () => {
    expect(ehFalhaPermanente({ name: 'QualquerCoisa', $metadata: { httpStatusCode: 404 } })).toBe(true);
  });

  it('trata erro de rede como transitorio, para a mensagem voltar para a fila', () => {
    expect(ehFalhaPermanente(Object.assign(new Error('socket hang up'), { name: 'TimeoutError' }))).toBe(false);
  });

  it('trata throttling e 5xx como transitorios', () => {
    expect(ehFalhaPermanente({ name: 'SlowDown', $metadata: { httpStatusCode: 503 } })).toBe(false);
    expect(ehFalhaPermanente({ name: 'InternalError', $metadata: { httpStatusCode: 500 } })).toBe(false);
  });

  it('nao quebra com valores que nao sao objeto', () => {
    expect(ehFalhaPermanente(null)).toBe(false);
    expect(ehFalhaPermanente(undefined)).toBe(false);
    expect(ehFalhaPermanente('NoSuchKey')).toBe(false);
  });
});

/**
 * Falha de credencial/permissao e permanente: sem esta distincao o loop de
 * 5s repete o mesmo ERROR para sempre. Aconteceu ao apontar o backend para a
 * chave do `epi-inferencia-local`, que nao tem acesso a `fila-resultados-web`.
 */
describe('ehFalhaDeCredencial', () => {
  it('reconhece AccessDenied do SQS (policy nao cobre a fila)', () => {
    expect(ehFalhaDeCredencial(Object.assign(new Error('nao autorizado'), { name: 'AccessDenied' }))).toBe(true);
  });

  it('reconhece chave invalida e assinatura errada', () => {
    expect(ehFalhaDeCredencial({ name: 'InvalidClientTokenId' })).toBe(true);
    expect(ehFalhaDeCredencial({ name: 'UnrecognizedClientException' })).toBe(true);
    expect(ehFalhaDeCredencial({ name: 'SignatureDoesNotMatch' })).toBe(true);
  });

  it('reconhece fila inexistente — nome errado no .env nunca se resolve sozinho', () => {
    expect(ehFalhaDeCredencial({ name: 'QueueDoesNotExist' })).toBe(true);
  });

  it('reconhece 403 independente do name', () => {
    expect(ehFalhaDeCredencial({ name: 'Outro', $metadata: { httpStatusCode: 403 } })).toBe(true);
  });

  it('NAO trata falha de rede como credencial — essa tem que continuar tentando', () => {
    expect(ehFalhaDeCredencial(Object.assign(new Error('socket hang up'), { name: 'TimeoutError' }))).toBe(false);
    expect(ehFalhaDeCredencial({ name: 'SlowDown', $metadata: { httpStatusCode: 503 } })).toBe(false);
  });

  it('nao quebra com valores que nao sao objeto', () => {
    expect(ehFalhaDeCredencial(null)).toBe(false);
    expect(ehFalhaDeCredencial('AccessDenied')).toBe(false);
  });
});
