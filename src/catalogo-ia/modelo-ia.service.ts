import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RecursoNaoEncontradoError } from '../shared/erros/recurso-nao-encontrado.error.js';
import { PaginaDto } from '../shared/dto/pagina.dto.js';
import type { PaginacaoQuery } from '../shared/dto/paginacao.query.js';
import type { AtualizarModeloIaDto } from './dto/atualizar-modelo-ia.dto.js';
import type { CriarModeloIaDto } from './dto/criar-modelo-ia.dto.js';
import { ModeloIaResponse } from './dto/modelo-ia.response.js';
import { ModeloIa } from './modelo-ia.entity.js';

@Injectable()
export class ModeloIaService {
  constructor(
    @InjectRepository(ModeloIa)
    private readonly repo: Repository<ModeloIa>,
  ) {}

  async criar(dto: CriarModeloIaDto): Promise<ModeloIaResponse> {
    const modelo = this.repo.create({
      nome: dto.nome,
      versao: dto.versao,
      tipoDeteccao: dto.tipoDeteccao,
      limiarConfianca: dto.limiarConfianca ?? 0.7,
      metricas: dto.metricas ?? null,
      hashArtefato: dto.hashArtefato ?? null,
    });

    return ModeloIaResponse.de(await this.repo.save(modelo));
  }

  async listar(
    paginacao: PaginacaoQuery,
    filtros: { ativo?: boolean; nome?: string } = {},
  ): Promise<PaginaDto<ModeloIaResponse>> {
    const qb = this.repo
      .createQueryBuilder('m')
      .orderBy('m.nome', 'ASC')
      .addOrderBy('m.publicadoEm', 'DESC');

    if (filtros.ativo !== undefined) qb.andWhere('m.ativo = :ativo', { ativo: filtros.ativo });
    if (filtros.nome) qb.andWhere('m.nome = :nome', { nome: filtros.nome });

    const [itens, total] = await qb.skip(paginacao.pular).take(paginacao.tamanho).getManyAndCount();

    return PaginaDto.de(itens.map(ModeloIaResponse.de), total, paginacao.pagina, paginacao.tamanho);
  }

  async buscarPorId(id: string): Promise<ModeloIaResponse> {
    return ModeloIaResponse.de(await this.exigirModelo(id));
  }

  /**
   * So `ativo` e `limiarConfianca` mudam — o trigger `trg_modelo_ia_imutavel`
   * bloqueia UPDATE de qualquer outra coluna. Ver AtualizarModeloIaDto.
   */
  async atualizar(id: string, dto: AtualizarModeloIaDto): Promise<ModeloIaResponse> {
    const modelo = await this.exigirModelo(id);

    Object.assign(modelo, {
      ativo: dto.ativo ?? modelo.ativo,
      limiarConfianca: dto.limiarConfianca ?? modelo.limiarConfianca,
    });

    return ModeloIaResponse.de(await this.repo.save(modelo));
  }

  private async exigirModelo(id: string): Promise<ModeloIa> {
    const modelo = await this.repo.findOne({ where: { id } });
    if (!modelo) throw new RecursoNaoEncontradoError('ModeloIa', id);
    return modelo;
  }
}
