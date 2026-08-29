/**
 * O que o ApiKeyGuard resolve a partir da credencial e deixa em
 * `req.dispositivo`. Rotas em `/dispositivo/*` nao recebem `:cameraId` no
 * path por causa disto: a camera vem da credencial, nunca do cliente —
 * elimina IDOR por construcao.
 */
export interface DispositivoAutenticado {
  credencialId: string;
  cameraId: string;
  escopos: string[];
}
