import { HttpStatus, ValidationPipe, type ValidationError } from '@nestjs/common';
import { ErroValidacaoError } from '../erros/erro-validacao.error.js';

function achatar(erros: ValidationError[], prefixo = ''): { campo: string; restricoes: string[] }[] {
  return erros.flatMap((erro) => {
    const campo = prefixo ? `${prefixo}.${erro.property}` : erro.property;
    const proprios = erro.constraints
      ? [{ campo, restricoes: Object.values(erro.constraints) }]
      : [];
    const filhos = erro.children?.length ? achatar(erro.children, campo) : [];
    return [...proprios, ...filhos];
  });
}

export function criarValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    // whitelist + forbidNonWhitelisted matam a categoria inteira de mass
    // assignment sobre a maquina de estados: um PATCH de descricao nao
    // consegue carregar { status: 'RESOLVIDA' } junto.
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    // Deliberadamente false: com conversao implicita, um @IsInt() em query
    // string transforma 'abc' em NaN silenciosamente e o filtro do painel
    // devolve resultado errado sem erro. Use @Type(() => Number).
    transformOptions: { enableImplicitConversion: false },
    errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    exceptionFactory: (erros) => new ErroValidacaoError(achatar(erros)),
  });
}
