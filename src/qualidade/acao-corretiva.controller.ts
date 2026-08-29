import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UsuarioAtual } from '../auth/decorators/usuario-atual.decorator.js';
import type { UsuarioAutenticado } from '../auth/tipos/usuario-autenticado.js';
import { CicloQualidadeService } from './ciclo-qualidade.service.js';
import { ConcluirAcaoDto } from './dto/concluir-acao.dto.js';
import { RegistrarVerificacaoDto } from './dto/registrar-verificacao.dto.js';
import { Verificacao } from './verificacao.entity.js';

@ApiTags('acoes-corretivas')
@ApiBearerAuth('jwt')
@Controller('acoes-corretivas')
export class AcaoCorretivaController {
  constructor(
    private readonly ciclo: CicloQualidadeService,
    @InjectRepository(Verificacao)
    private readonly verificacoes: Repository<Verificacao>,
  ) {}

  @Post(':id/conclusao')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Executor declara a correcao feita',
    description:
      'Move a NC para AGUARDANDO_VERIFICACAO. A NC ainda NAO esta fechada: ' +
      'fechada_em continua nulo ate a verificacao aprovar.',
  })
  concluir(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConcluirAcaoDto,
    @UsuarioAtual() ator: UsuarioAutenticado,
  ) {
    return this.ciclo.concluirAcao(id, dto, ator);
  }

  @Post(':id/verificacoes')
  @ApiOperation({
    summary: 'Segundo engenheiro verifica a correcao',
    description:
      'SEGREGACAO DE FUNCAO: quem executou a acao nao pode verifica-la — ' +
      'devolve 422 SEGREGACAO_FUNCAO_VIOLADA. APROVADA fecha a NC com ' +
      'fechada_em = verificado_em; REPROVADA devolve a NC para EM_CORRECAO ' +
      'sem estender o prazo.',
  })
  verificar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegistrarVerificacaoDto,
    @UsuarioAtual() ator: UsuarioAutenticado,
  ) {
    return this.ciclo.registrarVerificacao(id, dto, ator);
  }

  @Get(':id/verificacoes')
  @ApiOperation({ summary: 'Historico de verificacoes da acao (append-only)' })
  listarVerificacoes(@Param('id', ParseUUIDPipe) id: string) {
    return this.verificacoes.find({
      where: { acaoCorretivaId: id },
      order: { verificadoEm: 'ASC' },
    });
  }
}
