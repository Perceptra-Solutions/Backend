import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Papeis } from '../auth/decorators/papeis.decorator.js';
import { PapelUsuario } from '../shared/enums/dominio.enums.js';
import { CameraService } from './camera.service.js';
import { AtualizarCameraDto } from './dto/atualizar-camera.dto.js';
import { AtualizarStreamDto } from './dto/atualizar-stream.dto.js';
import { CriarCameraDto } from './dto/criar-camera.dto.js';
import { EmitirCredencialDto } from './dto/emitir-credencial.dto.js';
import { FiltroCameraQuery } from './dto/filtro-camera.query.js';

@ApiTags('cameras')
@ApiBearerAuth('jwt')
@Controller('cameras')
export class CameraController {
  constructor(private readonly cameras: CameraService) {}

  @Post()
  @Papeis(PapelUsuario.GESTOR)
  @ApiOperation({
    summary: 'Cadastra uma camera',
    description: 'Nasce sempre ATIVA, sem URL de stream — use PATCH :id/stream para defini-la.',
  })
  criar(@Body() dto: CriarCameraDto) {
    return this.cameras.criar(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista cameras', description: 'Filtre por obraId para o inventario de uma obra.' })
  listar(@Query() filtro: FiltroCameraQuery) {
    return this.cameras.listar(filtro, filtro);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de uma camera' })
  buscar(@Param('id', ParseUUIDPipe) id: string) {
    return this.cameras.buscarPorId(id);
  }

  @Patch(':id')
  @Papeis(PapelUsuario.GESTOR)
  @ApiOperation({
    summary: 'Atualiza o cadastro de uma camera',
    description:
      'A obra da camera nao muda por aqui. `status` permite marcar MANUTENCAO manualmente; ' +
      'OFFLINE por falta de heartbeat continua automatico.',
  })
  atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarCameraDto) {
    return this.cameras.atualizar(id, dto);
  }

  @Post(':id/credenciais')
  @Papeis(PapelUsuario.GESTOR)
  @ApiOperation({
    summary: 'Emite uma credencial de dispositivo para a camera',
    description:
      'A chave completa (campo `chave`) e mostrada UMA VEZ nesta resposta. ' +
      'O servidor nunca guarda o segredo em claro — so o hash.',
  })
  emitirCredencial(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EmitirCredencialDto) {
    return this.cameras.emitirCredencial(id, dto.escopos);
  }

  @Post(':id/credenciais/:credencialId/revogacao')
  @Papeis(PapelUsuario.GESTOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoga uma credencial de dispositivo',
    description: 'Irreversivel: emita uma nova credencial se a camera precisar continuar operando.',
  })
  async revogarCredencial(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('credencialId', ParseUUIDPipe) credencialId: string,
  ) {
    await this.cameras.revogarCredencial(id, credencialId);
    return { mensagem: 'Credencial revogada.' };
  }

  @Patch(':id/stream')
  @Papeis(PapelUsuario.GESTOR)
  @ApiOperation({
    summary: 'Define a URL de stream da camera (RTSP)',
    description:
      'Enviada em texto plano nesta requisicao; a API cifra (AES-256-GCM) antes de gravar. ' +
      'A resposta nunca inclui a URL, cifrada ou nao.',
  })
  atualizarStream(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarStreamDto) {
    return this.cameras.atualizarStream(id, dto.urlStream);
  }
}
