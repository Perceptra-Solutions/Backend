import { registerAs } from '@nestjs/config';

export const evidenciaConfig = registerAs('evidencia', () => ({
  driver: (process.env.EVIDENCIA_STORAGE_DRIVER ?? 'local') as 's3' | 'local',
  maxBytes: Number(process.env.EVIDENCIA_MAX_BYTES),
  mimesPermitidos: (process.env.EVIDENCIA_MIME_PERMITIDOS ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean),
  tmpPath: process.env.EVIDENCIA_TMP_PATH as string,
  localPath: process.env.EVIDENCIA_STORAGE_PATH,
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    bucket: process.env.S3_BUCKET as string,
    region: process.env.S3_REGION ?? 'auto',
    accessKeyId: process.env.S3_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY as string,
    urlTtlSegundos: Number(process.env.S3_URL_TTL_SEGUNDOS ?? 300),
  },
}));
