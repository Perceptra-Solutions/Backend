import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Papeis } from '../auth/decorators/papeis.decorator.js';
import { PapelUsuario } from '../shared/enums/dominio.enums.js';
import { AtualizarObraDto } from './dto/atualizar-obra.dto.js';
import { CriarObraDto } from './dto/criar-obra.dto.js';
import { FiltroObraQuery } from './dto/filtro-obra.query.js';
import { ObraService } from './obra.service.js';

@ApiTags('obras')
@ApiBearerAuth('jwt')
@Controller('obras')
export class ObraController {
  constructor(private readonly obras: ObraService) {}

  @Post()
  @Papeis(PapelUsuario.GESTOR)
  @ApiOperation({ summary: 'Cadastra uma obra' })
  criar(@Body() dto: CriarObraDto) {
    return this.obras.criar(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista obras', description: 'Alimenta os seletores de obra em todo o sistema.' })
  listar(@Query() filtro: FiltroObraQuery) {
    return this.obras.listar(filtro, filtro);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de uma obra' })
  buscar(@Param('id', ParseUUIDPipe) id: string) {
    return this.obras.buscarPorId(id);
  }

  @Patch(':id')
  @Papeis(PapelUsuario.GESTOR)
  @ApiOperation({ summary: 'Atualiza dados cadastrais da obra' })
  atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarObraDto) {
    return this.obras.atualizar(id, dto);
  }
}
