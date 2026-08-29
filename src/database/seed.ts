import dataSource from './data-source.js';
import { SENHA_PADRAO_SEED, semear } from './seed.dados.js';

/**
 * Popula o banco apontado por DATABASE_URL. Roda com:
 *   npm run db:seed
 *
 * Recusa rodar sobre banco que ja tem dados, para nao duplicar a obra na
 * vespera da apresentacao. Use --forcar para limpar antes.
 */
const forcar = process.argv.includes('--forcar');

await dataSource.initialize();

try {
  const [{ n }] = await dataSource.query<[{ n: number }]>(
    `SELECT count(*)::int n FROM obra`,
  );

  if (n > 0 && !forcar) {
    console.error(
      `O banco ja tem ${n} obra(s). Rode com --forcar para limpar e semear de novo:\n` +
        `  npm run db:seed -- --forcar`,
    );
    process.exit(1);
  }

  if (n > 0) {
    console.log('Limpando dados existentes...');
    // TRUNCATE nao dispara os triggers BEFORE UPDATE/DELETE de imutabilidade,
    // entao consegue limpar evidencia e verificacao — que e o comportamento
    // desejado aqui e IMPOSSIVEL pela API, de proposito.
    await dataSource.query(`TRUNCATE evidencia, verificacao, acao_corretiva,
      nao_conformidade, deteccao, camera, local, requisito_norma, modelo_ia,
      obra, usuario, relatorio_item, relatorio RESTART IDENTITY CASCADE`);
    await dataSource.query(`ALTER SEQUENCE seq_nc_codigo RESTART WITH 1`);
  }

  const resultado = await semear((sql, params) => dataSource.query(sql, params as never[]));

  console.log('Seed concluido.');
  console.log(`  obra .................. ${resultado.obraId}`);
  console.log(`  deteccoes ............. ${resultado.totais.deteccoes}`);
  console.log(`  nao conformidades ..... ${resultado.totais.naoConformidades}`);
  console.log('');
  console.log('  Usuarios (senha unica de desenvolvimento):');
  console.log(`    gestora@perceptra.dev  GESTOR      ${SENHA_PADRAO_SEED}`);
  console.log(`    ana@perceptra.dev      ENGENHEIRO  ${SENHA_PADRAO_SEED}`);
  console.log(`    bruno@perceptra.dev    ENGENHEIRO  ${SENHA_PADRAO_SEED}`);
  console.log('');
  console.log('  Ana executou a acao da NC resolvida; Bruno verificou.');
  console.log('  E essa separacao que a demo da segregacao de funcao usa.');
} finally {
  await dataSource.destroy();
}
