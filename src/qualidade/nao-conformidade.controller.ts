import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Papeis } from '../auth/decorators/papeis.decorator.js';
import { UsuarioAtual } from '../auth/decorators/usuario-atual.decorator.js';
import type { UsuarioAutenticado } from '../auth/tipos/usuario-autenticado.js';
import { PapelUsuario } from '../shared/enums/dominio.enums.js';
import { CicloQualidadeService } from './ciclo-qualidade.service.js';
import { AbrirNcManualDto } from './dto/abrir-nc.dto.js';
import { AtribuirResponsavelDto } from './dto/atribuir-responsavel.dto.js';
import { AtualizarNcDto } from './dto/atualizar-nc.dto.js';
import { CancelarNcDto } from './dto/cancelar-nc.dto.js';
import { CriarAcaoCorretivaDto } from './dto/criar-acao-corretiva.dto.js';
import { FiltroNcQuery } from './dto/filtro-nc.query.js';
import { NaoConformidadeService } from './nao-conformidade.service.js';

/**
 * As transicoes de estado sao SUB-RECURSOS DE ACAO
 * (POST /nao-conformidades/:id/cancelamento), e nao PATCH em `status`.
 *
 * Um PATCH generico de status convida o cliente a inventar transicoes e nao
 * tem onde carregar o payload proprio de cada ato (o motivo do cancelamento,
 * o parecer da verificacao). Cada rota abaixo carrega uma intencao.
 */
@ApiTags('nao-conformidades')
@ApiBearerAuth('jwt')
@Controller('nao-conformidades')
export class NaoConformidadeController {
  constructor(
    private readonly ncs: NaoConformidadeService,
    private readonly ciclo: CicloQualidadeService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Abre NC manual (vistoria de campo, sem camera)',
    description: 'Para NC originada de deteccao use POST /deteccoes/:id/nao-conformidades.',
  })
  abrirManual(@Body() dto: AbrirNcManualDto, @UsuarioAtual() ator: UsuarioAutenticado) {
    return this.ciclo.abrirManual(dto, ator);
  }

  @Get()
  @ApiOperation({ summary: 'Lista NCs, mais urgentes primeiro' })
  listar(@Query() filtro: FiltroNcQuery) {
    return this.ncs.listar(filtro, filtro);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Dossie da NC, com acoes e verificacoes' })
  buscar(@Param('id', ParseUUIDPipe) id: string) {
    return this.ncs.buscarPorId(id);
  }

  @Get(':id/historico')
  @ApiOperation({
    summary: 'Linha do tempo da NC',
    description:
      'Quem mudou o quê, quando e por quê. Vem da tabela de eventos escrita ' +
      'por trigger, entao inclui alteracao feita fora da API.',
  })
  historico(@Param('id', ParseUUIDPipe) id: string) {
    return this.ncs.historico(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Corrige texto e classificacao',
    description: 'Status, codigo, severidade e prazo NAO mudam por aqui.',
  })
  atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarNcDto) {
    return this.ncs.atualizar(id, dto);
  }

  @Post(':id/atribuicoes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Define ou troca o responsavel pela NC' })
  atribuir(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtribuirResponsavelDto,
    @UsuarioAtual() ator: UsuarioAutenticado,
  ) {
    return this.ciclo.atribuirResponsavel(id, dto.responsavelId, ator);
  }

  @Post(':id/cancelamento')
  @Papeis(PapelUsuario.GESTOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancela a NC',
    description:
      'Somente GESTOR e com justificativa: cancelar e a rota mais facil para ' +
      'maquiar indicador. Se a NC veio de IA, a deteccao volta a FALSO_POSITIVO.',
  })
  cancelar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelarNcDto,
    @UsuarioAtual() ator: UsuarioAutenticado,
  ) {
    return this.ciclo.cancelar(id, dto, ator);
  }

  @Post(':id/acoes-corretivas')
  @ApiOperation({
    summary: 'Registra o plano de acao e move a NC para EM_CORRECAO',
    description: 'Somente o responsavel pela NC ou um gestor.',
  })
  criarAcao(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CriarAcaoCorretivaDto,
    @UsuarioAtual() ator: UsuarioAutenticado,
  ) {
    return this.ciclo.criarAcaoCorretiva(id, dto, ator);
  }
}
