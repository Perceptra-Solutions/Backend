import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { UsuarioAutenticado } from '../auth/tipos/usuario-autenticado.js';
import { PaginaDto } from '../shared/dto/pagina.dto.js';
import type { PaginacaoQuery } from '../shared/dto/paginacao.query.js';
import { StatusTriagem } from '../shared/enums/dominio.enums.js';
import { RecursoNaoEncontradoError } from '../shared/erros/recurso-nao-encontrado.error.js';
import { RegraNegocioError } from '../shared/erros/regra-negocio.error.js';
import { NaoConformidade } from '../qualidade/nao-conformidade.entity.js';
import { Deteccao } from './deteccao.entity.js';
import type { TriarDeteccaoDto } from './dto/triar-deteccao.dto.js';

export interface FiltroDeteccao {
  obraId?: string;
  cameraId?: string;
  statusTriagem?: StatusTriagem;
  classe?: string;
}

@Injectable()
export class TriagemService {
  constructor(
    @InjectRepository(Deteccao)
    private readonly repo: Repository<Deteccao>,
    @InjectRepository(NaoConformidade)
    private readonly ncs: Repository<NaoConformidade>,
  ) {}

  /** Fila de triagem do engenheiro. */
  async listar(paginacao: PaginacaoQuery, filtro: FiltroDeteccao) {
    const qb = this.repo.createQueryBuilder('d');

    if (filtro.obraId) qb.andWhere('d.obraId = :obraId', { obraId: filtro.obraId });
    if (filtro.cameraId) qb.andWhere('d.cameraId = :cameraId', { cameraId: filtro.cameraId });
    if (filtro.classe) qb.andWhere('d.classe = :classe', { classe: filtro.classe });
    if (filtro.statusTriagem) {
      qb.andWhere('d.statusTriagem = :st', { st: filtro.statusTriagem });
    }

    const [itens, total] = await qb
      // Mais recente primeiro: a fila e trabalhada de cima para baixo, e o
      // indice parcial ix_deteccao_pendente cobre exatamente esta ordem.
      .orderBy('d.ocorridoEm', 'DESC')
      .skip(paginacao.pular)
      .take(paginacao.tamanho)
      .getManyAndCount();

    return PaginaDto.de(itens, total, paginacao.pagina, paginacao.tamanho);
  }

  async buscarPorId(id: string) {
    const deteccao = await this.repo.findOne({ where: { id } });
    if (!deteccao) throw new RecursoNaoEncontradoError('Deteccao', id);

    const nc = await this.ncs.findOne({ where: { deteccaoId: id } });

    return {
      ...deteccao,
      naoConformidade: nc ? { id: nc.id, codigo: nc.codigo, status: nc.status } : null,
    };
  }

  /**
   * Descarta a deteccao. So FALSO_POSITIVO e DUPLICADA passam por aqui:
   * confirmar e abrir a NC sao o mesmo ato, em
   * POST /deteccoes/:id/nao-conformidades.
   */
  async descartar(id: string, dto: TriarDeteccaoDto, ator: UsuarioAutenticado) {
    const deteccao = await this.repo.findOne({ where: { id } });
    if (!deteccao) throw new RecursoNaoEncontradoError('Deteccao', id);

    if (deteccao.statusTriagem !== StatusTriagem.PENDENTE) {
      const nc = await this.ncs.findOne({ where: { deteccaoId: id } });
      if (nc) {
        throw new RegraNegocioError(
          'DETECCAO_JA_TEM_NC',
          `Esta deteccao ja gerou a nao conformidade ${nc.codigo}. Cancele a NC antes de retriar.`,
        );
      }
      // Sem NC ligada, retriar e legitimo: o engenheiro pode ter errado.
    }

    const novoStatus = dto.resultado as unknown as StatusTriagem;

    if (novoStatus === StatusTriagem.DUPLICADA) {
      if (!dto.duplicadaDeId) {
        throw new RegraNegocioError(
          'DUPLICADA_EXIGE_ORIGINAL',
          'Ao marcar como duplicada, informe qual deteccao e a original.',
        );
      }

      const original = await this.repo.findOne({ where: { id: dto.duplicadaDeId } });
      if (!original) throw new RecursoNaoEncontradoError('Deteccao', dto.duplicadaDeId);

      if (original.id === deteccao.id) {
        throw new RegraNegocioError(
          'DUPLICADA_DE_SI_MESMA',
          'Uma deteccao nao pode ser duplicata dela mesma.',
        );
      }

      deteccao.duplicadaDeId = original.id;
    } else {
      // Trocar de DUPLICADA para FALSO_POSITIVO precisa limpar o vinculo,
      // senao o CHECK ck_deteccao_duplicada_status rejeita.
      deteccao.duplicadaDeId = null;
    }

    deteccao.statusTriagem = novoStatus;
    deteccao.triadoPor = ator.id;
    deteccao.triadoEm = new Date();

    return this.repo.save(deteccao);
  }
}
