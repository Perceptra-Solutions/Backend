import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';

/**
 * A unica porta para transacao neste projeto.
 *
 * Existe por dois motivos concretos:
 *
 * 1. As transicoes da NC cruzam agregados — fechar a NC, gravar a
 *    verificacao e atualizar a deteccao precisam acontecer juntas ou nao
 *    acontecer. Espalhar `dataSource.transaction()` pelos servicos faz
 *    alguem, uma hora, esquecer um pedaco fora dela.
 *
 * 2. O trigger de auditoria precisa saber QUEM agiu, e um trigger nao
 *    conhece o JWT. O ator viaja por variavel de sessao, definida aqui
 *    dentro da mesma transacao.
 */
@Injectable()
export class UnidadeTrabalho {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Executa `trabalho` numa transacao, registrando o ator para a auditoria.
   *
   * `set_config(..., true)` e o equivalente parametrizavel de `SET LOCAL`:
   * o `SET LOCAL` literal nao aceita parametro de query, e concatenar o id
   * na string seria injecao de SQL de graca. O `true` final limita o valor
   * a esta transacao — sem ele o ator vazaria para a proxima query que
   * pegasse a mesma conexao no pool.
   */
  async executar<T>(
    atorId: string | null,
    trabalho: (manager: EntityManager) => Promise<T>,
    motivo?: string,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('perceptra.ator_id', $1, true)`, [atorId ?? '']);
      await manager.query(`SELECT set_config('perceptra.motivo', $1, true)`, [motivo ?? '']);
      return trabalho(manager);
    });
  }

  /**
   * Trava a linha da NC para a transicao de estado.
   *
   * O MER nao tem coluna de versao, entao lock otimista nao e possivel: o
   * pessimista e o unico mecanismo disponivel. Sem ele, aprovar e cancelar
   * simultaneamente produz last-write-wins silencioso — os dois leem
   * AGUARDANDO_VERIFICACAO, os dois acham a transicao valida, e o ultimo
   * UPDATE vence sem que ninguem perceba.
   */
  async travarNc<T extends { id: string }>(
    manager: EntityManager,
    entidade: new () => T,
    id: string,
  ): Promise<T | null> {
    return manager
      .createQueryBuilder(entidade, 'nc')
      .setLock('pessimistic_write')
      .where('nc.id = :id', { id })
      .getOne();
  }
}
