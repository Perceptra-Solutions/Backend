import type { PapelUsuario } from '../../shared/enums/dominio.enums.js';

/**
 * O que viaja no JWT e fica em `req.usuario`. Deliberadamente minimo:
 * qualquer dado a mais aqui vira dado desatualizado no bolso do cliente
 * ate o token expirar.
 */
export interface UsuarioAutenticado {
  id: string;
  nome: string;
  papel: PapelUsuario;
}

/** Payload assinado no token. `sub` e o padrao JWT para o id do sujeito. */
export interface PayloadJwt {
  sub: string;
  nome: string;
  papel: PapelUsuario;
}
