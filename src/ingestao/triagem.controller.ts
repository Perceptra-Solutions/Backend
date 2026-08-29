import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Papeis } from '../auth/decorators/papeis.decorator.js';
import { UsuarioAtual } from '../auth/decorators/usuario-atual.decorator.js';
import type { UsuarioAutenticado } from '../auth/tipos/usuario-autenticado.js';
import { PapelUsuario } from '../shared/enums/dominio.enums.js';
import { FiltroDeteccaoQuery } from './dto/filtro-deteccao.query.js';
import { TriarDeteccaoDto } from './dto/triar-deteccao.dto.js';
import { TriagemService } from './triagem.service.js';

@ApiTags('deteccoes')
@ApiBearerAuth('jwt')
@Controller('deteccoes')
export class TriagemController {
  constructor(private readonly triagem: TriagemService) {}

  @Get()
  @ApiOperation({
    summary: 'Fila de triagem',
    description: 'Filtre por statusTriagem=PENDENTE para a fila de trabalho do engenheiro.',
  })
  listar(@Query() filtro: FiltroDeteccaoQuery) {
    return this.triagem.listar(filtro, filtro);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe da deteccao, com a NC gerada se houver' })
  buscar(@Param('id', ParseUUIDPipe) id: string) {
    return this.triagem.buscarPorId(id);
  }

  @Post(':id/triagem')
  @Papeis(PapelUsuario.ENGENHEIRO)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Descarta a deteccao (falso positivo ou duplicada)',
    description:
      'Ato tecnico: somente ENGENHEIRO — o gestor nao tem CREA e nao tria. ' +
      'CONFIRMADA nao existe aqui: confirmar e abrir a NC sao o mesmo ato, em ' +
      'POST /deteccoes/:id/nao-conformidades.',
  })
  descartar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TriarDeteccaoDto,
    @UsuarioAtual() ator: UsuarioAutenticado,
  ) {
    return this.triagem.descartar(id, dto, ator);
  }
}
