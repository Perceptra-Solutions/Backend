import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Papeis } from '../auth/decorators/papeis.decorator.js';
import { PapelUsuario } from '../shared/enums/dominio.enums.js';
import { AtualizarModeloIaDto } from './dto/atualizar-modelo-ia.dto.js';
import { CriarModeloIaDto } from './dto/criar-modelo-ia.dto.js';
import { FiltroModeloIaQuery } from './dto/filtro-modelo-ia.query.js';
import { ModeloIaService } from './modelo-ia.service.js';

@ApiTags('modelos-ia')
@ApiBearerAuth('jwt')
@Controller('modelos-ia')
export class ModeloIaController {
  constructor(private readonly modelos: ModeloIaService) {}

  @Post()
  @Papeis(PapelUsuario.GESTOR)
  @ApiOperation({
    summary: 'Publica uma versao de modelo de IA',
    description: 'Cada versao e uma linha nova — nunca UPDATE numa ja publicada.',
  })
  criar(@Body() dto: CriarModeloIaDto) {
    return this.modelos.criar(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Lista modelos de IA',
    description: 'Alimenta o seletor de modelo ao cadastrar uma camera.',
  })
  listar(@Query() filtro: FiltroModeloIaQuery) {
    return this.modelos.listar(filtro, filtro);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de uma versao de modelo de IA' })
  buscar(@Param('id', ParseUUIDPipe) id: string) {
    return this.modelos.buscarPorId(id);
  }

  @Patch(':id')
  @Papeis(PapelUsuario.GESTOR)
  @ApiOperation({
    summary: 'Aposenta ou reajusta o limiar de confianca de um modelo',
    description:
      'Versao publicada e imutavel: so ativo e limiarConfianca podem mudar. ' +
      'Qualquer outro campo exige publicar uma versao nova.',
  })
  atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarModeloIaDto) {
    return this.modelos.atualizar(id, dto);
  }
}
