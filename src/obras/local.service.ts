import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TipoLocal } from '../shared/enums/dominio.enums.js';
import { RecursoNaoEncontradoError } from '../shared/erros/recurso-nao-encontrado.error.js';
import { PaginaDto } from '../shared/dto/pagina.dto.js';
import type { PaginacaoQuery } from '../shared/dto/paginacao.query.js';
import type { AtualizarLocalDto } from './dto/atualizar-local.dto.js';
import type { CriarLocalDto } from './dto/criar-local.dto.js';
import { LocalResponse } from './dto/local.response.js';
import { Local } from './local.entity.js';

@Injectable()
export class LocalService {
  constructor(
    @InjectRepository(Local)
    private readonly repo: Repository<Local>,
  ) {}

  async criar(dto: CriarLocalDto): Promise<LocalResponse> {
    const local = this.repo.create({
      obraId: dto.obraId,
      tipo: dto.tipo,
      nome: dto.nome,
      codigo: dto.codigo ?? null,
    });

    return LocalResponse.de(await this.repo.save(local));
  }

  async listar(
    paginacao: PaginacaoQuery,
    filtros: { obraId?: string; tipo?: TipoLocal } = {},
  ): Promise<PaginaDto<LocalResponse>> {
    const qb = this.repo.createQueryBuilder('l').orderBy('l.nome', 'ASC');

    if (filtros.obraId) qb.andWhere('l.obraId = :obraId', { obraId: filtros.obraId });
    if (filtros.tipo) qb.andWhere('l.tipo = :tipo', { tipo: filtros.tipo });

    const [itens, total] = await qb.skip(paginacao.pular).take(paginacao.tamanho).getManyAndCount();

    return PaginaDto.de(itens.map(LocalResponse.de), total, paginacao.pagina, paginacao.tamanho);
  }

  async buscarPorId(id: string): Promise<LocalResponse> {
    return LocalResponse.de(await this.exigirLocal(id));
  }

  async atualizar(id: string, dto: AtualizarLocalDto): Promise<LocalResponse> {
    const local = await this.exigirLocal(id);

    Object.assign(local, {
      tipo: dto.tipo ?? local.tipo,
      nome: dto.nome ?? local.nome,
      codigo: dto.codigo === undefined ? local.codigo : (dto.codigo ?? null),
    });

    return LocalResponse.de(await this.repo.save(local));
  }

  private async exigirLocal(id: string): Promise<Local> {
    const local = await this.repo.findOne({ where: { id } });
    if (!local) throw new RecursoNaoEncontradoError('Local', id);
    return local;
  }
}
