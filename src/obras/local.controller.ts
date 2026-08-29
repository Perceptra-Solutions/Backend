import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Papeis } from '../auth/decorators/papeis.decorator.js';
import { PapelUsuario } from '../shared/enums/dominio.enums.js';
import { AtualizarLocalDto } from './dto/atualizar-local.dto.js';
import { CriarLocalDto } from './dto/criar-local.dto.js';
import { FiltroLocalQuery } from './dto/filtro-local.query.js';
import { LocalService } from './local.service.js';

@ApiTags('locais')
@ApiBearerAuth('jwt')
@Controller('locais')
export class LocalController {
  constructor(private readonly locais: LocalService) {}

  @Post()
  @Papeis(PapelUsuario.GESTOR)
  @ApiOperation({ summary: 'Cadastra um local dentro de uma obra' })
  criar(@Body() dto: CriarLocalDto) {
    return this.locais.criar(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Lista locais',
    description: 'Filtre por obraId para alimentar o seletor de local de uma obra.',
  })
  listar(@Query() filtro: FiltroLocalQuery) {
    return this.locais.listar(filtro, filtro);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de um local' })
  buscar(@Param('id', ParseUUIDPipe) id: string) {
    return this.locais.buscarPorId(id);
  }

  @Patch(':id')
  @Papeis(PapelUsuario.GESTOR)
  @ApiOperation({
    summary: 'Atualiza um local',
    description: 'A obra do local nao muda por aqui: um local nao troca de obra depois de criado.',
  })
  atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarLocalDto) {
    return this.locais.atualizar(id, dto);
  }
}
