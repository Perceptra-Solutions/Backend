import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { UsuarioAtual } from '../auth/decorators/usuario-atual.decorator.js';
import type { UsuarioAutenticado } from '../auth/tipos/usuario-autenticado.js';
import { CriarEvidenciaDto } from './dto/criar-evidencia.dto.js';
import { FiltroEvidenciaQuery } from './dto/filtro-evidencia.query.js';
import { EvidenciaService } from './evidencia.service.js';

@ApiTags('evidencias')
@ApiBearerAuth('jwt')
@Controller('evidencias')
export class EvidenciaController {
  constructor(private readonly evidencias: EvidenciaService) {}

  @Post()
  @UseInterceptors(FileInterceptor('arquivo'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload de evidencia (cadeia de custodia)',
    description:
      'Campo de arquivo: "arquivo". Precisa vincular a ao menos uma deteccao, ' +
      'nao conformidade ou acao corretiva.',
  })
  criar(
    @UploadedFile() arquivo: Express.Multer.File | undefined,
    @Body() dto: CriarEvidenciaDto,
    @UsuarioAtual() autor: UsuarioAutenticado,
  ) {
    return this.evidencias.criar(arquivo, dto, autor);
  }

  @Get()
  @ApiOperation({ summary: 'Lista evidencias, filtrando por vinculo' })
  listar(@Query() filtro: FiltroEvidenciaQuery) {
    return this.evidencias.listar(filtro, filtro);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de uma evidencia' })
  buscar(@Param('id', ParseUUIDPipe) id: string) {
    return this.evidencias.buscarPorId(id);
  }

  @Get(':id/arquivo')
  @ApiProduces('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'application/pdf')
  @ApiOperation({
    summary: 'Baixa o conteudo da evidencia',
    description:
      'Funciona com qualquer driver de storage (local ou S3), ao contrario de `urlTemporaria` ' +
      '(so S3 gera URL assinada). Exige o mesmo Bearer das demais rotas.',
  })
  async arquivo(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { stream, mime, nome } = await this.evidencias.abrirArquivo(id);
    res.set({
      'Content-Type': mime,
      'Content-Disposition': `inline; filename="${nome}"`,
    });

    // Sem este handler, um erro no meio da leitura (arquivo removido depois
    // da checagem de existencia, disco com problema) emite 'error' sem
    // ouvinte e o Node derruba o PROCESSO INTEIRO, nao so esta requisicao.
    // Aqui os headers ja podem ter ido embora, entao so da para abortar.
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  @Get(':id/integridade')
  @ApiOperation({
    summary: 'Recalcula o hash a partir do storage e compara com o gravado',
    description: 'A prova da cadeia de custodia na demo: nao confia no banco, baixa de novo e recalcula.',
  })
  verificarIntegridade(@Param('id', ParseUUIDPipe) id: string) {
    return this.evidencias.verificarIntegridade(id);
  }
}
