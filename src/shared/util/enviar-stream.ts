import { Logger } from '@nestjs/common';
import type { Readable } from 'node:stream';
import type { Response } from 'express';

const logger = new Logger('enviarStream');

/**
 * Envia um stream de arquivo na resposta com o 'error' tratado.
 *
 * `stream.pipe(res)` sozinho e uma bomba: se o stream falhar DEPOIS de
 * comecar (arquivo removido no meio, disco com problema, conexao com o S3
 * caindo), o evento 'error' sai sem ouvinte e o Node encerra o processo com
 * `Unhandled 'error' event`. Num container com `restart: unless-stopped`
 * isso vira reinicio silencioso da API inteira — foi exatamente o que
 * aconteceu com uma evidencia cujo binario nao estava no volume.
 *
 * Aqui o erro e registrado e a resposta e encerrada. Se nada foi enviado
 * ainda, devolve 404; se o corpo ja comecou, so corta a conexao — nao da
 * mais para trocar o status.
 */
export function enviarStream(
  res: Response,
  stream: Readable,
  cabecalhos: { mime: string; nome: string },
): void {
  res.set({
    'Content-Type': cabecalhos.mime,
    'Content-Disposition': `inline; filename="${cabecalhos.nome}"`,
  });

  stream.on('error', (erro) => {
    logger.error(`Falha ao ler o arquivo do storage: ${erro instanceof Error ? erro.message : String(erro)}`);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(404).json({
      erro: {
        codigo: 'ARQUIVO_INDISPONIVEL',
        mensagem: 'O arquivo nao esta mais disponivel no armazenamento.',
        timestamp: new Date().toISOString(),
      },
    });
  });

  // Cliente desistiu do download: fecha o stream para nao vazar descritor.
  res.on('close', () => stream.destroy());

  stream.pipe(res);
}
