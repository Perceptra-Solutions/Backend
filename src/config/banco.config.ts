import { registerAs } from '@nestjs/config';

export const bancoConfig = registerAs('banco', () => ({
  url: process.env.DATABASE_URL as string,
  urlTeste: process.env.DATABASE_URL_TEST,
  ssl: process.env.DATABASE_SSL === 'true',
}));
