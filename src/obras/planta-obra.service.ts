import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ArmazenamentoPort } from '../armazenamento/armazenamento.port.js';
import { RecursoNaoEncontradoError } from '../shared/erros/recurso-nao-encontrado.error.js';
import { RegraNegocioError } from '../shared/erros/regra-negocio.error.js';
import { PlantaObraResponse } from './dto/planta-obra.response.js';
import { Obra } from './obra.entity.js';

/**
 * Formatos aceitos para a planta do canteiro.
 *
 * Lista própria, mais estreita que a da evidência: planta é imagem ou PDF —
 * vídeo não faz sentido aqui, e aceitar o que não se sabe exibir só cria
 * arquivo que a tela não consegue abrir.
 */
const MIMES_ACEITOS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
};

/**
 * Planta / mapa da obra.
 *
 * Reusa a mesma porta de storage da evidência (`ArmazenamentoPort`) e a mesma
 * ideia de chave endereçada por conteúdo. A diferença de propósito importa:
 * evidência é prova e é imutável; planta é cadastro e **pode ser
 * substituída** — subir outra troca a vigente, sem versionamento.
 */
@Injectable()
export class PlantaObraService {
  constructor(
    @InjectRepository(Obra)
    private readonly repo: Repository<Obra>,
    private readonly armazenamento: ArmazenamentoPort,
  ) {}

  /**
   * Substitui a planta vigente. O arquivo antigo NÃO é apagado do storage:
   * a chave é o hash do conteúdo, então dois uploads iguais convergem para o
   * mesmo objeto, e apagar seria arriscar remover algo ainda referenciado.
   */
  async enviar(obraId: string, arquivo: Express.Multer.File | undefined): Promise<PlantaObraResponse> {
    if (!arquivo) {
      throw new RegraNegocioError('ARQUIVO_OBRIGATORIO', 'Envie o arquivo no campo "arquivo".');
    }

    const extensao = MIMES_ACEITOS[arquivo.mimetype];
    if (!extensao) {
      await unlink(arquivo.path).catch(() => {});
      throw new RegraNegocioError(
        'MIME_NAO_PERMITIDO',
        `Tipo "${arquivo.mimetype}" não é aceito para planta. Use PNG, JPEG, WebP, SVG ou PDF.`,
      );
    }

    const obra = await this.exigirObra(obraId);
    const hash = await this.calcularHash(createReadStream(arquivo.path));
    const chave = `plantas/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}${extensao}`;

    try {
      await this.armazenamento.salvar(chave, arquivo.path, arquivo.mimetype);
    } finally {
      await unlink(arquivo.path).catch(() => {
        /* temporário do multer; falhar ao limpar não deve derrubar o upload */
      });
    }

    obra.plantaUri = chave;
    obra.plantaNome = arquivo.originalname;
    obra.plantaMime = arquivo.mimetype;
    obra.plantaHashSha256 = hash;
    obra.plantaTamanhoBytes = String(arquivo.size);
    obra.plantaAtualizadaEm = new Date();

    return PlantaObraResponse.de(await this.repo.save(obra));
  }

  /** Metadado da planta. `existe: false` quando a obra ainda não tem nenhuma. */
  async metadados(obraId: string): Promise<PlantaObraResponse> {
    return PlantaObraResponse.de(await this.exigirObra(obraId));
  }

  /**
   * Stream do arquivo. Lê direto do storage — funciona com qualquer driver,
   * ao contrário de URL assinada, que só o S3 gera.
   */
  async abrirArquivo(obraId: string): Promise<{ stream: Readable; mime: string; nome: string }> {
    const obra = await this.exigirObra(obraId);
    if (!obra.plantaUri || !obra.plantaMime) {
      throw new RecursoNaoEncontradoError('Planta da obra', obraId);
    }

    return {
      stream: await this.armazenamento.abrirLeitura(obra.plantaUri),
      mime: obra.plantaMime,
      nome: obra.plantaNome ?? obra.plantaUri.split('/').pop() ?? 'planta',
    };
  }

  /**
   * `plantaUri` é `select: false` na entidade — sem o `addSelect` explícito
   * ela volta `undefined` e o download quebraria dizendo que não há planta.
   */
  private async exigirObra(id: string): Promise<Obra> {
    const obra = await this.repo
      .createQueryBuilder('o')
      .addSelect('o.plantaUri')
      .where('o.id = :id', { id })
      .getOne();

    if (!obra) throw new RecursoNaoEncontradoError('Obra', id);
    return obra;
  }

  private async calcularHash(origem: Readable): Promise<string> {
    const hash = createHash('sha256');
    await pipeline(origem, hash);
    return hash.digest('hex');
  }
}
