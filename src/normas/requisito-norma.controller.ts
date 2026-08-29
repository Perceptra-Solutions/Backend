import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Papeis } from '../auth/decorators/papeis.decorator.js';
import { PapelUsuario } from '../shared/enums/dominio.enums.js';
import { AtualizarRequisitoNormaDto } from './dto/atualizar-requisito-norma.dto.js';
import { CriarRequisitoNormaDto } from './dto/criar-requisito-norma.dto.js';
import { FiltroRequisitoNormaQuery } from './dto/filtro-requisito-norma.query.js';
import { RequisitoNormaService } from './requisito-norma.service.js';

/**
 * Tabela de dominio (ver comentario da entidade): baixo trafego de escrita,
 * normalmente populada por seed. GESTOR mantem o catalogo.
 */
@ApiTags('requisitos-norma')
@ApiBearerAuth('jwt')
@Controller('requisitos-norma')
export class RequisitoNormaController {
  constructor(private readonly requisitos: RequisitoNormaService) {}

  @Post()
  @Papeis(PapelUsuario.GESTOR)
  @ApiOperation({ summary: 'Cadastra um requisito de norma' })
  criar(@Body() dto: CriarRequisitoNormaDto) {
    return this.requisitos.criar(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Lista requisitos de norma',
    description: 'Alimenta o seletor de requisito ao classificar uma nao conformidade.',
  })
  listar(@Query() filtro: FiltroRequisitoNormaQuery) {
    return this.requisitos.listar(filtro, filtro);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de um requisito de norma' })
  buscar(@Param('id', ParseUUIDPipe) id: string) {
    return this.requisitos.buscarPorId(id);
  }

  @Patch(':id')
  @Papeis(PapelUsuario.GESTOR)
  @ApiOperation({ summary: 'Atualiza um requisito de norma' })
  atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarRequisitoNormaDto) {
    return this.requisitos.atualizar(id, dto);
  }
}
