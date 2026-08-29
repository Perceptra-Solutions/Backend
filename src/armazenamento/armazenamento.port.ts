import type { Readable } from 'node:stream';

/**
 * Porta de storage para evidencia. `abstract class`, nunca `interface`:
 * uma interface some no emit e o Nest nao tem o que resolver em tempo de
 * execucao para `@Inject(ArmazenamentoPort)`.
 *
 * Duas implementacoes: ArmazenamentoS3 (producao/demo online) e
 * ArmazenamentoLocal (fallback em disco, para demo offline). Qual delas e
 * usada e decidido uma vez, no ArmazenamentoModule, por `evidencia.driver`.
 */
export abstract class ArmazenamentoPort {
  /** Copia o arquivo em `caminhoOrigem` (path local, ja no disco) para `chave` no storage. */
  abstract salvar(chave: string, caminhoOrigem: string, contentType: string): Promise<void>;

  /** Stream de leitura do conteudo em `chave` — usado para recalcular o hash na verificacao de integridade. */
  abstract abrirLeitura(chave: string): Promise<Readable>;

  /** URL temporaria para download direto. `null` quando o driver nao suporta (ex.: local). */
  abstract gerarUrlTemporaria(chave: string): Promise<string | null>;
}
