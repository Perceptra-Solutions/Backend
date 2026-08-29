import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { enviarStream } from '../shared/util/enviar-stream.js';

import { Papeis } from '../auth/decorators/papeis.decorator.js';
import { UsuarioAtual } from '../auth/decorators/usuario-atual.decorator.js';
import type { UsuarioAutenticado } from '../auth/tipos/usuario-autenticado.js';
import { PapelUsuario } from '../shared/enums/dominio.enums.js';
import { FiltroRelatorioQuery } from './dto/filtro-relatorio.query.js';
import { GerarRelatorioDto } from './dto/gerar-relatorio.dto.js';
import { RelatorioService } from './relatorio.service.js';

@ApiTags('relatorios')
@ApiBearerAuth('jwt')
@Controller('relatorios')
export class RelatorioController {
  constructor(private readonly relatorios: RelatorioService) {}

  /**
   * Geracao e ato de gestao: quem emite o documento que vai para a auditoria
   * assina por ele. Leitura continua aberta aos dois papeis — o engenheiro
   * precisa conferir o que foi emitido sobre a obra dele.
   */
  @Post()
  @Papeis(PapelUsuario.GESTOR)
  @ApiOperation({
    summary: 'Gera um relatorio e congela as NCs que entraram nele',
    description:
      'Snapshot: as NCs que atendem aos filtros no momento da geracao viram linhas de ' +
      '`relatorio_item`, na ordem em que aparecem no documento. O arquivo e gravado no ' +
      'storage e o SHA-256 fica no banco para conferencia posterior.',
  })
  gerar(@Body() dto: GerarRelatorioDto, @UsuarioAtual() autor: UsuarioAutenticado) {
    return this.relatorios.gerar(dto, autor);
  }

  @Get()
  @ApiOperation({ summary: 'Lista os relatorios emitidos' })
  listar(@Query() filtro: FiltroRelatorioQuery) {
    return this.relatorios.listar(filtro);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe do relatorio, com as NCs congeladas na ordem do documento' })
  buscar(@Param('id', ParseUUIDPipe) id: string) {
    return this.relatorios.buscarPorId(id);
  }

  @Get(':id/arquivo')
  @ApiProduces('text/html')
  @ApiOperation({
    summary: 'Baixa o documento gerado',
    description:
      'Funciona com qualquer driver de storage, ao contrario de `urlTemporaria` (so S3 assina URL). ' +
      'O HTML e autocontido e imprime em PDF pelo navegador.',
  })
  async arquivo(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { stream, mime, nome } = await this.relatorios.abrirArquivo(id);
    enviarStream(res, stream, { mime, nome });
  }

  @Get(':id/integridade')
  @ApiOperation({
    summary: 'Recalcula o hash do arquivo armazenado e compara com o gravado',
    description: 'A mesma prova de cadeia de custodia da evidencia: nao confia no banco, le o arquivo de novo.',
  })
  verificarIntegridade(@Param('id', ParseUUIDPipe) id: string) {
    return this.relatorios.verificarIntegridade(id);
  }
}
