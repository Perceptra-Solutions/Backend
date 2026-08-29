import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  nome: process.env.APP_NAME ?? 'perceptra',
  ambiente: process.env.NODE_ENV ?? 'development',
  porta: Number(process.env.PORT ?? 3000),
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  swaggerHabilitado: process.env.SWAGGER_ENABLED !== 'false',
}));
