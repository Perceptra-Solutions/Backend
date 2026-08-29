import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CategoriaDesempenho } from '../shared/enums/dominio.enums.js';
import { RecursoNaoEncontradoError } from '../shared/erros/recurso-nao-encontrado.error.js';
import { PaginaDto } from '../shared/dto/pagina.dto.js';
import type { PaginacaoQuery } from '../shared/dto/paginacao.query.js';
import type { AtualizarRequisitoNormaDto } from './dto/atualizar-requisito-norma.dto.js';
import type { CriarRequisitoNormaDto } from './dto/criar-requisito-norma.dto.js';
import { RequisitoNormaResponse } from './dto/requisito-norma.response.js';
import { RequisitoNorma } from './requisito-norma.entity.js';

@Injectable()
export class RequisitoNormaService {
  constructor(
    @InjectRepository(RequisitoNorma)
    private readonly repo: Repository<RequisitoNorma>,
  ) {}

  async criar(dto: CriarRequisitoNormaDto): Promise<RequisitoNormaResponse> {
    const requisito = this.repo.create({
      norma: dto.norma,
      item: dto.item,
      categoria: dto.categoria,
      descricao: dto.descricao,
    });

    return RequisitoNormaResponse.de(await this.repo.save(requisito));
  }

  async listar(
    paginacao: PaginacaoQuery,
    filtros: { categoria?: CategoriaDesempenho; norma?: string } = {},
  ): Promise<PaginaDto<RequisitoNormaResponse>> {
    const qb = this.repo.createQueryBuilder('r').orderBy('r.norma', 'ASC').addOrderBy('r.item', 'ASC');

    if (filtros.categoria) qb.andWhere('r.categoria = :categoria', { categoria: filtros.categoria });
    if (filtros.norma) qb.andWhere('r.norma = :norma', { norma: filtros.norma });

    const [itens, total] = await qb.skip(paginacao.pular).take(paginacao.tamanho).getManyAndCount();

    return PaginaDto.de(itens.map(RequisitoNormaResponse.de), total, paginacao.pagina, paginacao.tamanho);
  }

  async buscarPorId(id: string): Promise<RequisitoNormaResponse> {
    return RequisitoNormaResponse.de(await this.exigirRequisito(id));
  }

  async atualizar(id: string, dto: AtualizarRequisitoNormaDto): Promise<RequisitoNormaResponse> {
    const requisito = await this.exigirRequisito(id);

    Object.assign(requisito, {
      norma: dto.norma ?? requisito.norma,
      item: dto.item ?? requisito.item,
      categoria: dto.categoria ?? requisito.categoria,
      descricao: dto.descricao ?? requisito.descricao,
    });

    return RequisitoNormaResponse.de(await this.repo.save(requisito));
  }

  private async exigirRequisito(id: string): Promise<RequisitoNorma> {
    const requisito = await this.repo.findOne({ where: { id } });
    if (!requisito) throw new RecursoNaoEncontradoError('RequisitoNorma', id);
    return requisito;
  }
}
