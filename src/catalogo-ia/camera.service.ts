import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { StatusCamera } from '../shared/enums/dominio.enums.js';
import { ConflitoError } from '../shared/erros/conflito.error.js';
import { RecursoNaoEncontradoError } from '../shared/erros/recurso-nao-encontrado.error.js';
import { PaginaDto } from '../shared/dto/pagina.dto.js';
import type { PaginacaoQuery } from '../shared/dto/paginacao.query.js';
import { Camera } from './camera.entity.js';
import { CredencialDispositivo } from './credencial-dispositivo.entity.js';
import { cifrarUrlStream } from './dominio/camera-stream.crypto.js';
import { gerarCredencial } from './dominio/credencial-dispositivo.util.js';
import { ESCOPOS_DISPOSITIVO } from './dominio/escopos-dispositivo.js';
import type { AtualizarCameraDto } from './dto/atualizar-camera.dto.js';
import { CameraResponse } from './dto/camera.response.js';
import type { CriarCameraDto } from './dto/criar-camera.dto.js';
import type { CredencialEmitidaResponse } from './dto/credencial-emitida.response.js';

@Injectable()
export class CameraService {
  constructor(
    @InjectRepository(Camera)
    private readonly cameras: Repository<Camera>,
    @InjectRepository(CredencialDispositivo)
    private readonly credenciais: Repository<CredencialDispositivo>,
    private readonly config: ConfigService,
  ) {}

  async criar(dto: CriarCameraDto): Promise<CameraResponse> {
    const camera = this.cameras.create({
      obraId: dto.obraId,
      localId: dto.localId ?? null,
      modeloIaId: dto.modeloIaId ?? null,
      identificador: dto.identificador,
      fabricante: dto.fabricante ?? null,
      protocolo: dto.protocolo ?? 'RTSP',
      instaladaEm: dto.instaladaEm ?? null,
    });

    return CameraResponse.de(await this.cameras.save(camera));
  }

  async listar(
    paginacao: PaginacaoQuery,
    filtros: { obraId?: string; localId?: string; modeloIaId?: string; status?: StatusCamera } = {},
  ): Promise<PaginaDto<CameraResponse>> {
    const qb = this.cameras.createQueryBuilder('c').orderBy('c.identificador', 'ASC');

    if (filtros.obraId) qb.andWhere('c.obraId = :obraId', { obraId: filtros.obraId });
    if (filtros.localId) qb.andWhere('c.localId = :localId', { localId: filtros.localId });
    if (filtros.modeloIaId) qb.andWhere('c.modeloIaId = :modeloIaId', { modeloIaId: filtros.modeloIaId });
    if (filtros.status) qb.andWhere('c.status = :status', { status: filtros.status });

    const [itens, total] = await qb.skip(paginacao.pular).take(paginacao.tamanho).getManyAndCount();

    return PaginaDto.de(itens.map(CameraResponse.de), total, paginacao.pagina, paginacao.tamanho);
  }

  async buscarPorId(id: string): Promise<CameraResponse> {
    return CameraResponse.de(await this.exigirCamera(id));
  }

  async atualizar(id: string, dto: AtualizarCameraDto): Promise<CameraResponse> {
    const camera = await this.exigirCamera(id);

    Object.assign(camera, {
      localId: dto.localId === undefined ? camera.localId : (dto.localId ?? null),
      modeloIaId: dto.modeloIaId === undefined ? camera.modeloIaId : (dto.modeloIaId ?? null),
      identificador: dto.identificador ?? camera.identificador,
      fabricante: dto.fabricante === undefined ? camera.fabricante : (dto.fabricante ?? null),
      protocolo: dto.protocolo ?? camera.protocolo,
      instaladaEm: dto.instaladaEm === undefined ? camera.instaladaEm : (dto.instaladaEm ?? null),
      status: dto.status ?? camera.status,
    });

    return CameraResponse.de(await this.cameras.save(camera));
  }

  /**
   * Emite uma credencial nova para a camera. A chave completa (`chave`) so
   * existe nesta resposta — o banco guarda apenas `hash_secreto`.
   */
  async emitirCredencial(
    cameraId: string,
    escopos?: string[],
  ): Promise<CredencialEmitidaResponse> {
    await this.exigirCamera(cameraId);

    const pepper = this.config.getOrThrow<string>('camera.deviceApiKeyPepper');
    const gerada = gerarCredencial(pepper);

    const credencial = await this.credenciais.save(
      this.credenciais.create({
        cameraId,
        prefixo: gerada.prefixo,
        hashSecreto: gerada.hashSecreto,
        escopos: escopos && escopos.length > 0 ? escopos : [...ESCOPOS_DISPOSITIVO],
      }),
    );

    return {
      id: credencial.id,
      prefixo: credencial.prefixo,
      chave: gerada.chave,
      escopos: credencial.escopos,
      criadaEm: credencial.criadaEm,
    };
  }

  async revogarCredencial(cameraId: string, credencialId: string): Promise<void> {
    const credencial = await this.credenciais.findOne({
      where: { id: credencialId, cameraId },
    });
    if (!credencial) throw new RecursoNaoEncontradoError('CredencialDispositivo', credencialId);

    if (credencial.revogadaEm) {
      throw new ConflitoError('CREDENCIAL_JA_REVOGADA', 'Esta credencial ja esta revogada.');
    }

    credencial.revogadaEm = new Date();
    await this.credenciais.save(credencial);
  }

  /** Cifra e grava a URL de stream. Nunca retorna o valor — nem cifrado, nem em claro. */
  async atualizarStream(cameraId: string, urlStreamPlano: string): Promise<{ atualizadaEm: Date }> {
    const camera = await this.exigirCamera(cameraId);

    const chave = this.config.getOrThrow<string>('camera.chaveCriptografiaStream');
    camera.urlStream = cifrarUrlStream(urlStreamPlano, chave);
    await this.cameras.save(camera);

    return { atualizadaEm: new Date() };
  }

  private async exigirCamera(id: string): Promise<Camera> {
    const camera = await this.cameras.findOne({ where: { id } });
    if (!camera) throw new RecursoNaoEncontradoError('Camera', id);
    return camera;
  }
}
