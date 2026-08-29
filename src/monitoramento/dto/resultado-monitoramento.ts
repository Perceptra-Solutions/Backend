/** Forma bruta de uma detecção dentro do `.json` que o serviço de inferência grava em `processed/`. */
export interface DeteccaoBrutaJson {
  classe_id: number;
  classe: string;
  confianca: number;
  /** [x1, y1, x2, y2] em pixels — ver ARQUITETURA_AWS.md. */
  caixa: [number, number, number, number];
}

export interface AlertaMonitoramento {
  tipo: string;
  mensagem: string;
}

/** O que o SqsConsumidorService emite e o front recebe via SSE. */
export interface ResultadoMonitoramento {
  imagemOriginal: string;
  /** URL pré-assinada da imagem anotada (`processed/*.jpg`), expira em `monitoramento.urlTtlSegundos`. */
  imagemUrl: string;
  deteccoesEpi: DeteccaoBrutaJson[];
  deteccoesFissura: DeteccaoBrutaJson[];
  alertas: AlertaMonitoramento[];
  recebidoEm: string;
}
