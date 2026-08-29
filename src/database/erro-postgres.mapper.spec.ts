import { mapearErroPostgres } from './erro-postgres.mapper.js';
import { ConflitoError } from '../shared/erros/conflito.error.js';
import { RegraNegocioError } from '../shared/erros/regra-negocio.error.js';

/** Simula o QueryFailedError do TypeORM, que embrulha o erro do driver pg. */
function erroTypeorm(driverError: Record<string, unknown>) {
  return { name: 'QueryFailedError', message: 'query failed', driverError };
}

describe('mapearErroPostgres', () => {
  it('devolve null quando o erro nao vem do banco', () => {
    expect(mapearErroPostgres(new Error('qualquer'))).toBeNull();
    expect(mapearErroPostgres(null)).toBeNull();
    expect(mapearErroPostgres({ code: 42 })).toBeNull();
  });

  it('devolve null para SQLSTATE que nao tratamos, para o erro seguir como 500', () => {
    expect(mapearErroPostgres(erroTypeorm({ code: '08006' }))).toBeNull();
  });

  it('traduz unique violation da deteccao em conflito com mensagem de dominio', () => {
    const erro = mapearErroPostgres(
      erroTypeorm({ code: '23505', constraint: 'nao_conformidade_deteccao_id_key' }),
    );

    expect(erro).toBeInstanceOf(ConflitoError);
    expect(erro?.codigo).toBe('DETECCAO_JA_TEM_NC');
    expect(erro?.status).toBe(409);
    expect(erro?.message).toContain('no maximo uma NC');
  });

  it('traduz o CHECK de origem da NC', () => {
    const erro = mapearErroPostgres(erroTypeorm({ code: '23514', constraint: 'ck_nc_origem' }));

    expect(erro).toBeInstanceOf(RegraNegocioError);
    expect(erro?.codigo).toBe('ORIGEM_NC_INCONSISTENTE');
    expect(erro?.status).toBe(422);
  });

  it('usa a mensagem do RAISE quando o trigger nao tem constraint mapeada', () => {
    const erro = mapearErroPostgres(
      erroTypeorm({
        code: '23514',
        message: 'segregacao_de_funcao: executor nao pode verificar a propria acao',
      }),
    );

    expect(erro?.codigo).toBe('REGRA_VIOLADA');
    expect(erro?.message).toContain('segregacao_de_funcao');
  });

  it('traduz 0A000 dos triggers de imutabilidade em 409', () => {
    const erro = mapearErroPostgres(
      erroTypeorm({ code: '0A000', table: 'evidencia', message: 'evidencia e imutavel' }),
    );

    expect(erro?.codigo).toBe('REGISTRO_IMUTAVEL');
    expect(erro?.status).toBe(409);
  });

  it('trata unique desconhecida com fallback generico, sem quebrar', () => {
    const erro = mapearErroPostgres(erroTypeorm({ code: '23505', constraint: 'ux_inventada' }));

    expect(erro?.codigo).toBe('RECURSO_DUPLICADO');
    expect(erro?.status).toBe(409);
  });

  it('aceita o erro cru do pg, sem o embrulho do TypeORM', () => {
    const erro = mapearErroPostgres({ code: '23503', constraint: 'fk_nc_obra' });

    expect(erro?.codigo).toBe('REFERENCIA_INVALIDA');
    expect(erro?.status).toBe(422);
  });
});

describe('mapearErroPostgres — RESTRICT', () => {
  it('traduz 23001 de ON DELETE RESTRICT em 409 com orientacao', () => {
    const erro = mapearErroPostgres({ code: '23001', constraint: 'fk_evidencia_nc' });

    expect(erro?.codigo).toBe('POSSUI_DEPENDENTES');
    expect(erro?.status).toBe(409);
    expect(erro?.message).toContain('Cancele ou desative');
  });
});
