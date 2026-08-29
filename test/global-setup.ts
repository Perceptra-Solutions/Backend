import { Client } from 'pg';

/**
 * Falha rapido e com instrucao, em vez de deixar o TypeORM tentar reconectar
 * por ~80s e terminar num AggregateError vazio.
 *
 * Os testes e2e sobem a aplicacao inteira, que inclui o DatabaseModule —
 * entao eles exigem um Postgres de verdade. Os testes unitarios NAO exigem:
 * `npm test` roda as invariantes de schema contra PGlite em processo.
 */
export default async function setup() {
  const url = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      'Defina DATABASE_URL_TEST (ou DATABASE_URL) no .env para rodar os testes e2e.',
    );
  }

  const client = new Client({ connectionString: url, connectionTimeoutMillis: 3000 });

  try {
    await client.connect();
    await client.query('SELECT 1');
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    throw new Error(
      `Os testes e2e precisam de um Postgres acessivel e nenhum respondeu.\n\n` +
        `  URL....: ${url.replace(/:\/\/[^@]*@/, '://***@')}\n` +
        `  Motivo.: ${motivo}\n\n` +
        `Suba o banco com Docker:\n` +
        `  docker compose up -d postgres\n\n` +
        `Os testes unitarios nao precisam de banco: npm test\n`,
    );
  } finally {
    await client.end().catch(() => {});
  }
}
