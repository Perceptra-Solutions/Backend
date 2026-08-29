import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ArmazenamentoPort } from '../armazenamento/armazenamento.port.js';
import type { UsuarioAutenticado } from '../auth/tipos/usuario-autenticado.js';
import { PaginaDto } from '../shared/dto/pagina.dto.js';
import type { PaginacaoQuery } from '../shared/dto/paginacao.query.js';
import { OrigemRegistro, TipoEvidencia } from '../shared/enums/dominio.enums.js';
import { RecursoNaoEncontradoError } from '../shared/erros/recurso-nao-encontrado.error.js';
import { RegraNegocioError } from '../shared/erros/regra-negocio.error.js';
import type { CriarEvidenciaDto } from './dto/criar-evidencia.dto.js';
import type { IntegridadeResponse } from './dto/integridade.response.js';
import { Evidencia } from './evidencia.entity.js';

export interface FiltroEvidencia {
  deteccaoId?: string;
  naoConformidadeId?: string;
  acaoCorretivaId?: string;
  tipo?: TipoEvidencia;
}

const EXTENSAO_POR_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'application/pdf': '.pdf',
};

@Injectable()
export class EvidenciaService {
  constructor(
    @InjectRepository(Evidencia)
    private readonly repo: Repository<Evidencia>,
    private readonly armazenamento: ArmazenamentoPort,
    private readonly config: ConfigService,
  ) {}

  /**
   * `arquivo.path` e o arquivo temporario que o multer (diskStorage) ja
   * gravou em disco antes deste metodo rodar — nunca em memoria
   * (`memoryStorage()` colocaria 200MB de video no heap do processo).
   */
  async criar(
    arquivo: Express.Multer.File | undefined,
    dto: CriarEvidenciaDto,
    autor: UsuarioAutenticado,
  ): Promise<Evidencia & { urlTemporaria: string | null }> {
    if (!arquivo) {
      throw new RegraNegocioError('ARQUIVO_OBRIGATORIO', 'Envie o arquivo no campo "arquivo".');
    }

    this.validarVinculo(dto);

    const mimesPermitidos = this.config.getOrThrow<string[]>('evidencia.mimesPermitidos');
    if (!mimesPermitidos.includes(arquivo.mimetype)) {
      await unlink(arquivo.path).catch(() => {});
      throw new RegraNegocioError(
        'MIME_NAO_PERMITIDO',
        `Tipo de arquivo "${arquivo.mimetype}" nao e aceito. Permitidos: ${mimesPermitidos.join(', ')}.`,
      );
    }

    const hash = await this.calcularHashStream(createReadStream(arquivo.path));
    // Chave por conteudo: duas evidencias identicas caem na mesma chave —
    // dedup de graca, sem precisar de logica extra.
    const chave = `evidencias/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}${EXTENSAO_POR_MIME[arquivo.mimetype] ?? ''}`;

    try {
      // Content-Type que vai para o storage e o mimetype JA VALIDADO contra
      // a allowlist — nunca um campo livre que o cliente poderia declarar
      // separadamente no corpo da requisicao.
      await this.armazenamento.salvar(chave, arquivo.path, arquivo.mimetype);
    } finally {
      await unlink(arquivo.path).catch(() => {
        /* arquivo temporario; falha ao limpar nao deve derrubar a requisicao */
      });
    }

    const evidencia = await this.repo.save(
      this.repo.create({
        tipo: this.tipoPorMime(arquivo.mimetype),
        uri: chave,
        hashSha256: hash,
        origem: OrigemRegistro.MANUAL,
        autorId: autor.id,
        deteccaoId: dto.deteccaoId ?? null,
        naoConformidadeId: dto.naoConformidadeId ?? null,
        acaoCorretivaId: dto.acaoCorretivaId ?? null,
        capturadoEm: dto.capturadoEm ? new Date(dto.capturadoEm) : new Date(),
        tamanhoBytes: String(arquivo.size),
        mime: arquivo.mimetype,
      }),
    );

    return { ...evidencia, urlTemporaria: await this.armazenamento.gerarUrlTemporaria(chave) };
  }

  async listar(paginacao: PaginacaoQuery, filtro: FiltroEvidencia): Promise<PaginaDto<Evidencia>> {
    const qb = this.repo.createQueryBuilder('e').orderBy('e.criadoEm', 'DESC');

    if (filtro.deteccaoId) qb.andWhere('e.deteccaoId = :d', { d: filtro.deteccaoId });
    if (filtro.naoConformidadeId) qb.andWhere('e.naoConformidadeId = :n', { n: filtro.naoConformidadeId });
    if (filtro.acaoCorretivaId) qb.andWhere('e.acaoCorretivaId = :a', { a: filtro.acaoCorretivaId });
    if (filtro.tipo) qb.andWhere('e.tipo = :t', { t: filtro.tipo });

    const [itens, total] = await qb.skip(paginacao.pular).take(paginacao.tamanho).getManyAndCount();
    return PaginaDto.de(itens, total, paginacao.pagina, paginacao.tamanho);
  }

  async buscarPorId(id: string): Promise<Evidencia & { urlTemporaria: string | null }> {
    const evidencia = await this.exigirEvidencia(id);
    return { ...evidencia, urlTemporaria: await this.armazenamento.gerarUrlTemporaria(evidencia.uri) };
  }

  /**
   * Le o conteudo direto do storage, funcionando com QUALQUER driver — ao
   * contrario de `urlTemporaria`, que e `null` no driver local. E a unica
   * forma do front exibir a imagem quando `EVIDENCIA_STORAGE_DRIVER=local`
   * (disco, sem URL assinada). Exige o mesmo Bearer das outras rotas: por
   * isso nao vira um link direto de `<img src>`, o front busca via fetch
   * autenticado e monta um blob URL.
   */
  async abrirArquivo(id: string): Promise<{ stream: Readable; mime: string; nome: string }> {
    const evidencia = await this.exigirEvidencia(id);
    return {
      stream: await this.armazenamento.abrirLeitura(evidencia.uri),
      mime: evidencia.mime ?? 'application/octet-stream',
      nome: evidencia.uri.split('/').pop() ?? id,
    };
  }

  /** A prova da cadeia de custodia: baixa de novo do storage e recalcula, nao confia no que esta no banco. */
  async verificarIntegridade(id: string): Promise<IntegridadeResponse> {
    const evidencia = await this.exigirEvidencia(id);
    const hashRecalculado = await this.calcularHashStream(
      await this.armazenamento.abrirLeitura(evidencia.uri),
    );

    return {
      integra: hashRecalculado === evidencia.hashSha256,
      hashArmazenado: evidencia.hashSha256,
      hashRecalculado,
    };
  }

  private validarVinculo(dto: CriarEvidenciaDto): void {
    const vinculos = [dto.deteccaoId, dto.naoConformidadeId, dto.acaoCorretivaId].filter(Boolean);
    if (vinculos.length === 0) {
      throw new RegraNegocioError(
        'EVIDENCIA_ORFA',
        'Informe ao menos um vinculo: deteccaoId, naoConformidadeId ou acaoCorretivaId.',
      );
    }
  }

  private tipoPorMime(mime: string): TipoEvidencia {
    if (mime.startsWith('image/')) return TipoEvidencia.FOTO;
    if (mime.startsWith('video/')) return TipoEvidencia.VIDEO;
    return TipoEvidencia.DOCUMENTO;
  }

  private async calcularHashStream(origem: Readable): Promise<string> {
    const hash = createHash('sha256');
    await pipeline(origem, hash);
    return hash.digest('hex');
  }

  private async exigirEvidencia(id: string): Promise<Evidencia> {
    const evidencia = await this.repo.findOne({ where: { id } });
    if (!evidencia) throw new RecursoNaoEncontradoError('Evidencia', id);
    return evidencia;
  }
}
