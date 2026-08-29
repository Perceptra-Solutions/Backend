import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { mapearErroPostgres } from '../../database/erro-postgres.mapper.js';
import { ErroDominio } from '../erros/erro-dominio.js';
import { lerRequestId } from '../middlewares/request-id.middleware.js';
import type { CorpoErroDto } from '../dto/erro.dto.js';

/**
 * Envelope unico de erro para toda a API. Tres familias:
 *   1. ErroDominio        -> carrega codigo + status proprios
 *   2. Erro do Postgres   -> passa pelo mapper (CHECK/trigger viram 422/409 legivel)
 *   3. HttpException      -> usa o proprio status
 * Qualquer outra coisa vira 500 generico, com o stack apenas no log.
 */
@Catch()
export class ExcecaoGlobalFilter implements ExceptionFilter {
  private readonly logger = new Logger('Excecao');

  constructor(private readonly exporStack: boolean) {}

  catch(excecao: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const { status, codigo, mensagem, detalhes } = this.traduzir(excecao);

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} -> ${status} ${codigo}`,
        excecao instanceof Error ? excecao.stack : String(excecao),
      );
    } else {
      this.logger.warn(`${req.method} ${req.originalUrl} -> ${status} ${codigo}: ${mensagem}`);
    }

    const corpo: CorpoErroDto = {
      codigo,
      mensagem,
      detalhes,
      requestId: lerRequestId(req),
      timestamp: new Date().toISOString(),
      caminho: req.originalUrl,
    };

    res.status(status).json({ erro: corpo });
  }

  private traduzir(excecao: unknown): {
    status: number;
    codigo: string;
    mensagem: string;
    detalhes?: unknown;
  } {
    if (excecao instanceof ErroDominio) {
      return {
        status: excecao.status,
        codigo: excecao.codigo,
        mensagem: excecao.message,
        detalhes: excecao.detalhes,
      };
    }

    // Antes de HttpException: um erro do banco pode ter escapado sem
    // tratamento no service, e ainda assim merece virar 409/422 util.
    const doBanco = mapearErroPostgres(excecao);
    if (doBanco) {
      return {
        status: doBanco.status,
        codigo: doBanco.codigo,
        mensagem: doBanco.message,
        detalhes: doBanco.detalhes,
      };
    }

    if (excecao instanceof HttpException) {
      const resposta = excecao.getResponse();
      const mensagem =
        typeof resposta === 'string'
          ? resposta
          : ((resposta as { message?: string | string[] }).message ?? excecao.message);

      return {
        status: excecao.getStatus(),
        codigo: this.codigoPorStatus(excecao.getStatus()),
        mensagem: Array.isArray(mensagem) ? mensagem.join('; ') : mensagem,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      codigo: 'ERRO_INTERNO',
      mensagem: 'Erro interno do servidor.',
      detalhes:
        this.exporStack && excecao instanceof Error
          ? { erro: excecao.message, stack: excecao.stack?.split('\n').slice(0, 8) }
          : undefined,
    };
  }

  private codigoPorStatus(status: number): string {
    const mapa: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'REQUISICAO_INVALIDA',
      [HttpStatus.UNAUTHORIZED]: 'NAO_AUTENTICADO',
      [HttpStatus.FORBIDDEN]: 'ACESSO_NEGADO',
      [HttpStatus.NOT_FOUND]: 'RECURSO_NAO_ENCONTRADO',
      [HttpStatus.CONFLICT]: 'RECURSO_DUPLICADO',
      [HttpStatus.PAYLOAD_TOO_LARGE]: 'ARQUIVO_MUITO_GRANDE',
      [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'TIPO_NAO_SUPORTADO',
      [HttpStatus.UNPROCESSABLE_ENTITY]: 'REGRA_VIOLADA',
      [HttpStatus.TOO_MANY_REQUESTS]: 'LIMITE_EXCEDIDO',
    };
    return mapa[status] ?? 'ERRO';
  }
}
