import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SenhaService } from '../auth/senha.service.js';
import { PapelUsuario } from '../shared/enums/dominio.enums.js';
import { ConflitoError } from '../shared/erros/conflito.error.js';
import { RecursoNaoEncontradoError } from '../shared/erros/recurso-nao-encontrado.error.js';
import { RegraNegocioError } from '../shared/erros/regra-negocio.error.js';
import { PaginaDto } from '../shared/dto/pagina.dto.js';
import type { PaginacaoQuery } from '../shared/dto/paginacao.query.js';
import type { AtualizarUsuarioDto } from './dto/atualizar-usuario.dto.js';
import type { CriarUsuarioDto } from './dto/criar-usuario.dto.js';
import { UsuarioResponse } from './dto/usuario.response.js';
import { Usuario } from './usuario.entity.js';

@Injectable()
export class UsuarioService {
  constructor(
    @InjectRepository(Usuario)
    private readonly repo: Repository<Usuario>,
    private readonly senhas: SenhaService,
  ) {}

  async criar(dto: CriarUsuarioDto): Promise<UsuarioResponse> {
    this.validarCrea(dto.papel, dto.crea);

    // Checagem antecipada apenas para a mensagem: a garantia real e o indice
    // unico em lower(email), que tambem cobre a corrida entre dois cadastros
    // simultaneos. O erro 23505 vira 409 no mapeador.
    const existente = await this.repo.findOne({ where: { email: dto.email } });
    if (existente) {
      throw new ConflitoError('EMAIL_JA_CADASTRADO', `Ja existe um usuario com o e-mail ${dto.email}.`);
    }

    const usuario = this.repo.create({
      nome: dto.nome,
      email: dto.email,
      senhaHash: await this.senhas.hash(dto.senha),
      papel: dto.papel,
      crea: dto.crea ?? null,
      ativo: true,
    });

    return UsuarioResponse.de(await this.repo.save(usuario));
  }

  async listar(
    paginacao: PaginacaoQuery,
    filtros: { papel?: PapelUsuario; ativo?: boolean } = {},
  ): Promise<PaginaDto<UsuarioResponse>> {
    const qb = this.repo.createQueryBuilder('u').orderBy('u.nome', 'ASC');

    if (filtros.papel) qb.andWhere('u.papel = :papel', { papel: filtros.papel });
    if (filtros.ativo !== undefined) qb.andWhere('u.ativo = :ativo', { ativo: filtros.ativo });

    const [itens, total] = await qb.skip(paginacao.pular).take(paginacao.tamanho).getManyAndCount();

    return PaginaDto.de(
      itens.map(UsuarioResponse.de),
      total,
      paginacao.pagina,
      paginacao.tamanho,
    );
  }

  async buscarPorId(id: string): Promise<UsuarioResponse> {
    return UsuarioResponse.de(await this.exigirUsuario(id));
  }

  async atualizar(id: string, dto: AtualizarUsuarioDto): Promise<UsuarioResponse> {
    const usuario = await this.exigirUsuario(id);

    // O papel nao muda por aqui, entao o papel vigente e quem decide se o
    // CREA informado e valido.
    if (dto.crea !== undefined) this.validarCrea(usuario.papel, dto.crea);

    Object.assign(usuario, {
      nome: dto.nome ?? usuario.nome,
      email: dto.email ?? usuario.email,
      crea: dto.crea === undefined ? usuario.crea : (dto.crea ?? null),
    });

    return UsuarioResponse.de(await this.repo.save(usuario));
  }

  /**
   * Desativa em vez de apagar. Usuario e autor de triagem, executor de acao
   * e verificador: apagar destruiria o rastro que sustenta a auditoria — e
   * as FKs sao RESTRICT justamente para impedir isso.
   */
  async desativar(id: string): Promise<UsuarioResponse> {
    const usuario = await this.exigirUsuario(id);

    if (!usuario.ativo) {
      throw new ConflitoError('USUARIO_JA_INATIVO', 'Este usuario ja esta desativado.');
    }

    usuario.ativo = false;
    return UsuarioResponse.de(await this.repo.save(usuario));
  }

  async reativar(id: string): Promise<UsuarioResponse> {
    const usuario = await this.exigirUsuario(id);
    usuario.ativo = true;
    return UsuarioResponse.de(await this.repo.save(usuario));
  }

  async trocarSenha(id: string, senhaAtual: string, senhaNova: string): Promise<void> {
    const usuario = await this.repo
      .createQueryBuilder('u')
      .addSelect('u.senhaHash')
      .where('u.id = :id', { id })
      .getOne();

    if (!usuario) throw new RecursoNaoEncontradoError('Usuario', id);

    if (!(await this.senhas.conferir(senhaAtual, usuario.senhaHash))) {
      throw new RegraNegocioError('SENHA_ATUAL_INCORRETA', 'A senha atual esta incorreta.');
    }

    usuario.senhaHash = await this.senhas.hash(senhaNova);
    await this.repo.save(usuario);
  }

  /**
   * Usado pelos outros modulos para checar que quem vai receber uma
   * atribuicao existe, esta ativo e tem o papel certo. Usuario inativo nao
   * recebe atribuicao NOVA — os registros antigos permanecem, sao historico.
   */
  async exigirEngenheiroAtivo(id: string): Promise<Usuario> {
    const usuario = await this.exigirUsuario(id);

    if (!usuario.ativo) {
      throw new RegraNegocioError(
        'USUARIO_INATIVO',
        `${usuario.nome} esta desativado e nao pode receber novas atribuicoes.`,
      );
    }

    if (usuario.papel !== PapelUsuario.ENGENHEIRO) {
      throw new RegraNegocioError(
        'EXIGE_ENGENHEIRO',
        `Esta atribuicao e um ato tecnico e exige um ENGENHEIRO. ${usuario.nome} e ${usuario.papel}.`,
      );
    }

    return usuario;
  }

  private async exigirUsuario(id: string): Promise<Usuario> {
    const usuario = await this.repo.findOne({ where: { id } });
    if (!usuario) throw new RecursoNaoEncontradoError('Usuario', id);
    return usuario;
  }

  /**
   * CREA e do engenheiro. O banco tem o mesmo CHECK, mas o erro dele nao
   * explica nada ao usuario final — esta validacao existe pela mensagem.
   */
  private validarCrea(papel: PapelUsuario, crea?: string | null): void {
    if (papel === PapelUsuario.ENGENHEIRO && !crea) {
      throw new RegraNegocioError(
        'CREA_OBRIGATORIO',
        'Engenheiro precisa de CREA: e ele que responde tecnicamente pela triagem e pela verificacao.',
      );
    }

    if (papel !== PapelUsuario.ENGENHEIRO && crea) {
      throw new RegraNegocioError(
        'CREA_SO_PARA_ENGENHEIRO',
        'Somente usuarios com papel ENGENHEIRO podem ter CREA.',
      );
    }
  }
}
