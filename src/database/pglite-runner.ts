import { PGlite } from '@electric-sql/pglite';
import type { QueryRunner } from 'typeorm';
import { MIGRATIONS } from './migrations/index-migrations.js';

/**
 * Executa as migrations reais contra um PGlite EM PROCESSO, sem socket.
 *
 * Por que existe: o `pglite-server` (socket TCP) e single-connection e
 * dessincroniza o protocolo depois de um ErrorResponse — o erro da query N
 * chega no catch da query N+1, e reconectar derruba o servidor. Numa suite
 * que testa dezenas de "isto DEVE ser rejeitado", isso produz um relatorio
 * silenciosamente deslocado. Em processo nao ha socket, nao ha esse problema,
 * e ainda roda mais rapido.
 *
 * Isto NAO substitui o Postgres de desenvolvimento (Neon ou local): serve
 * para verificar o schema e as invariantes de forma deterministica, inclusive
 * em CI, sem instalar nada.
 */
export interface BancoEmMemoria {
  /** Executa SQL. Lanca com `code` no formato SQLSTATE, como o driver pg. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  fechar(): Promise<void>;
}

interface ErroPglite {
  code?: string;
  message?: string;
  constraint?: string;
}

export async function criarBancoComMigrations(): Promise<BancoEmMemoria> {
  const pg = await PGlite.create();

  // Adaptador minimo com a forma de QueryRunner que as migrations usam.
  // Elas so chamam `query()`, entao o resto do contrato nao e necessario.
  const runner = {
    query: async (sql: string, params?: unknown[]) => {
      const r = await pg.query(sql, params as never[]);
      return r.rows;
    },
  } as unknown as QueryRunner;

  for (const Migration of MIGRATIONS) {
    const migration = new Migration();
    await migration.up(runner);
  }

  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      try {
        const r = await pg.query(sql, params as never[]);
        return r.rows as T[];
      } catch (erro) {
        // O PGlite lanca um Error com `code`/`constraint`, igual ao driver pg,
        // mas nem sempre preserva o tipo — normalizamos para o mapper e os
        // testes poderem chavear por SQLSTATE.
        const e = erro as ErroPglite;
        const normalizado = Object.assign(new Error(e.message ?? String(erro)), {
          code: e.code,
          constraint: e.constraint,
        });
        throw normalizado;
      }
    },
    fechar: () => pg.close(),
  };
}
