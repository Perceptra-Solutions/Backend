// Carrega o .env no processo do Vitest. Necessario porque o globalSetup e
// este proprio config rodam fora do Nest, e quem le o .env na aplicacao e o
// ConfigModule — que so existe depois que o app sobe.
import 'dotenv/config';
import { defineConfig } from 'vitest/config';

// Os testes e2e sobem a aplicacao inteira contra um banco REAL. Apontam para
// o banco de teste, nunca para o de desenvolvimento: a suite trunca tabelas.
const urlDeTeste = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? '';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],

    // Confere o banco ANTES de subir a aplicacao: erro claro em 3s em vez
    // de ~80s de retry do TypeORM terminando num AggregateError vazio.
    globalSetup: ['./test/global-setup.ts'],

    // Env dos workers definida aqui, e nao no script npm: `npm run` usa
    // cmd.exe no Windows, onde o prefixo `NODE_ENV=test ...` nao existe.
    // DATABASE_URL e sobrescrita para o banco de teste, de modo que a
    // aplicacao sob teste nunca toque o banco de desenvolvimento.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: urlDeTeste,
    },

    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
