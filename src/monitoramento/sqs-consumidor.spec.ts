import { ehFalhaPermanente } from './sqs-consumidor.service.js';

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
