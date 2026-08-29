import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthService } from './auth.service.js';
import { Publico } from './decorators/publico.decorator.js';
import { UsuarioAtual } from './decorators/usuario-atual.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { LoginResponse } from './dto/login.response.js';
import type { UsuarioAutenticado } from './tipos/usuario-autenticado.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Publico()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Autentica e emite o JWT' })
  @ApiOkResponse({ type: LoginResponse })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get('eu')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Devolve o usuario do token',
    description: 'O front usa para montar o menu e esconder acoes sem permissao.',
  })
  perfil(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.auth.perfil(usuario.id);
  }
}
