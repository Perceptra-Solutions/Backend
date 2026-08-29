import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { StatusObra } from '../shared/enums/dominio.enums.js';
import { RecursoNaoEncontradoError } from '../shared/erros/recurso-nao-encontrado.error.js';
import { PaginaDto } from '../shared/dto/pagina.dto.js';
import type { PaginacaoQuery } from '../shared/dto/paginacao.query.js';
import type { AtualizarObraDto } from './dto/atualizar-obra.dto.js';
import type { CriarObraDto } from './dto/criar-obra.dto.js';
import { ObraResponse } from './dto/obra.response.js';
import { Obra } from './obra.entity.js';

@Injectable()
export class ObraService {
  constructor(
    @InjectRepository(Obra)
    private readonly repo: Repository<Obra>,
  ) {}

  async criar(dto: CriarObraDto): Promise<ObraResponse> {
    const obra = this.repo.create({
      codigo: dto.codigo,
      nome: dto.nome,
      endereco: dto.endereco ?? null,
      cidade: dto.cidade ?? null,
      uf: dto.uf ?? null,
      status: dto.status ?? StatusObra.EM_ANDAMENTO,
      responsavelTecnicoId: dto.responsavelTecnicoId ?? null,
      inicioPrevisto: dto.inicioPrevisto ?? null,
      fimPrevisto: dto.fimPrevisto ?? null,
    });

    return ObraResponse.de(await this.repo.save(obra));
  }

  async listar(
    paginacao: PaginacaoQuery,
    filtros: { status?: StatusObra; uf?: string; responsavelTecnicoId?: string } = {},
  ): Promise<PaginaDto<ObraResponse>> {
    const qb = this.repo.createQueryBuilder('o').orderBy('o.nome', 'ASC');

    if (filtros.status) qb.andWhere('o.status = :status', { status: filtros.status });
    if (filtros.uf) qb.andWhere('o.uf = :uf', { uf: filtros.uf });
    if (filtros.responsavelTecnicoId) {
      qb.andWhere('o.responsavelTecnicoId = :responsavelTecnicoId', {
        responsavelTecnicoId: filtros.responsavelTecnicoId,
      });
    }

    const [itens, total] = await qb.skip(paginacao.pular).take(paginacao.tamanho).getManyAndCount();

    return PaginaDto.de(itens.map(ObraResponse.de), total, paginacao.pagina, paginacao.tamanho);
  }

  async buscarPorId(id: string): Promise<ObraResponse> {
    return ObraResponse.de(await this.exigirObra(id));
  }

  async atualizar(id: string, dto: AtualizarObraDto): Promise<ObraResponse> {
    const obra = await this.exigirObra(id);

    Object.assign(obra, {
      codigo: dto.codigo ?? obra.codigo,
      nome: dto.nome ?? obra.nome,
      endereco: dto.endereco === undefined ? obra.endereco : (dto.endereco ?? null),
      cidade: dto.cidade === undefined ? obra.cidade : (dto.cidade ?? null),
      uf: dto.uf === undefined ? obra.uf : (dto.uf ?? null),
      status: dto.status ?? obra.status,
      responsavelTecnicoId:
        dto.responsavelTecnicoId === undefined
          ? obra.responsavelTecnicoId
          : (dto.responsavelTecnicoId ?? null),
      inicioPrevisto:
        dto.inicioPrevisto === undefined ? obra.inicioPrevisto : (dto.inicioPrevisto ?? null),
      fimPrevisto: dto.fimPrevisto === undefined ? obra.fimPrevisto : (dto.fimPrevisto ?? null),
    });

    return ObraResponse.de(await this.repo.save(obra));
  }

  private async exigirObra(id: string): Promise<Obra> {
    const obra = await this.repo.findOne({ where: { id } });
    if (!obra) throw new RecursoNaoEncontradoError('Obra', id);
    return obra;
  }
}
