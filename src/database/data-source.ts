import 'dotenv/config';
import { DataSource } from 'typeorm';
import { ENTIDADES } from './entidades.js';
import { MIGRATIONS } from './migrations/index-migrations.js';

/**
 * DataSource usado APENAS pelo CLI do TypeORM (migration:run / :revert / :show).
 * A aplicacao usa o TypeOrmModule.forRootAsync do database.module.ts.
 *
 * Roda contra o BUILD, nao contra .ts:
 *   npm run build && node node_modules/typeorm/cli.js migration:run -d ./dist/database/data-source.js
 *
 * Por que nao `typeorm-ts-node-esm`: ele depende de ts-node@10.9.2, que nao
 * conhece TypeScript 6 nem os loader hooks atuais do Node 24. Compilar antes
 * e deterministico e nao adiciona dependencia nenhuma.
 *
 * Este e o unico lugar da aplicacao que importa 'dotenv/config': o CLI roda
 * fora do Nest, entao nao existe ConfigModule para carregar o .env.
 */
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities: ENTIDADES,
  migrations: MIGRATIONS,
  // NUNCA true neste projeto: o synchronize apaga CHECK, trigger e indice
  // parcial sem avisar, e e neles que moram as invariantes do MER.
  synchronize: false,
  migrationsTableName: 'migracao',
  logging: process.env.TYPEORM_LOG === 'true' ? 'all' : ['error', 'warn'],
});
