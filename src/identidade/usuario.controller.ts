import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Papeis } from '../auth/decorators/papeis.decorator.js';
import { UsuarioAtual } from '../auth/decorators/usuario-atual.decorator.js';
import type { UsuarioAutenticado } from '../auth/tipos/usuario-autenticado.js';
import { PapelUsuario } from '../shared/enums/dominio.enums.js';
import { FiltroUsuarioQuery } from './dto/filtro-usuario.query.js';
import { AtualizarUsuarioDto } from './dto/atualizar-usuario.dto.js';
import { CriarUsuarioDto } from './dto/criar-usuario.dto.js';
import { TrocarSenhaDto } from './dto/trocar-senha.dto.js';
import { UsuarioService } from './usuario.service.js';

@ApiTags('usuarios')
@ApiBearerAuth('jwt')
@Controller('usuarios')
export class UsuarioController {
  constructor(private readonly usuarios: UsuarioService) {}

  @Post()
  @Papeis(PapelUsuario.GESTOR)
  @ApiOperation({
    summary: 'Cadastra um usuario',
    description: 'Somente GESTOR. Nao existe auto-cadastro nesta aplicacao.',
  })
  criar(@Body() dto: CriarUsuarioDto) {
    return this.usuarios.criar(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Lista usuarios',
    description: 'Alimenta os seletores de responsavel, executor e verificador.',
  })
  listar(@Query() filtro: FiltroUsuarioQuery) {
    return this.usuarios.listar(filtro, filtro);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de um usuario' })
  buscar(@Param('id', ParseUUIDPipe) id: string) {
    return this.usuarios.buscarPorId(id);
  }

  @Patch(':id')
  @Papeis(PapelUsuario.GESTOR)
  @ApiOperation({
    summary: 'Atualiza dados cadastrais',
    description: 'Papel e senha nao mudam por aqui, de proposito.',
  })
  atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarUsuarioDto) {
    return this.usuarios.atualizar(id, dto);
  }

  @Post(':id/desativacao')
  @Papeis(PapelUsuario.GESTOR)
  @ApiOperation({
    summary: 'Desativa um usuario',
    description:
      'Nao existe exclusao: o usuario e autor de triagem, executor de acao e ' +
      'verificador. Apagar destruiria o rastro que sustenta a auditoria.',
  })
  desativar(@Param('id', ParseUUIDPipe) id: string) {
    return this.usuarios.desativar(id);
  }

  @Post(':id/reativacao')
  @Papeis(PapelUsuario.GESTOR)
  @ApiOperation({ summary: 'Reativa um usuario desativado' })
  reativar(@Param('id', ParseUUIDPipe) id: string) {
    return this.usuarios.reativar(id);
  }

  @Post('eu/senha')
  @ApiOperation({
    summary: 'Troca a propria senha',
    description: 'Exige a senha atual. Ninguem troca a senha de outra pessoa.',
  })
  async trocarSenha(@UsuarioAtual() atual: UsuarioAutenticado, @Body() dto: TrocarSenhaDto) {
    await this.usuarios.trocarSenha(atual.id, dto.senhaAtual, dto.senhaNova);
    return { mensagem: 'Senha alterada.' };
  }
}
