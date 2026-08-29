import { registerAs } from '@nestjs/config';

/**
 * AWS do pipeline de EPI/fissura (Raspberry Pi -> S3 -> SQS -> inferencia ->
 * S3 -> SQS -> aqui) — ver ARQUITETURA_AWS.md. Bucket, regiao e fila NAO sao
 * segredo (sao so endereco de recurso), mas as credenciais do usuario IAM
 * `web-backend-epis` sim: ficam vazias por padrao, quem roda localmente
 * preenche no .env.
 *
 * Tudo opcional de proposito: sem credencial, o SqsConsumidorService loga um
 * aviso e nao inicia o polling, em vez de derrubar o boot da API inteira.
 */
export const monitoramentoConfig = registerAs('monitoramento', () => ({
  regiao: process.env.MONITORAMENTO_AWS_REGION ?? 'sa-east-1',
  bucket: process.env.MONITORAMENTO_AWS_BUCKET ?? 'perceptra-epis-1',
  filaResultadosUrl: process.env.MONITORAMENTO_AWS_QUEUE_URL,
  accessKeyId: process.env.MONITORAMENTO_AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.MONITORAMENTO_AWS_SECRET_ACCESS_KEY,
  urlTtlSegundos: Number(process.env.MONITORAMENTO_URL_TTL_SEGUNDOS ?? 300),
}));
