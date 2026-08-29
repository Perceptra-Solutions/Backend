import { SeveridadeNc, StatusNc, TipoRelatorio } from '../../shared/enums/dominio.enums.js';

/**
 * Uma NC como ela entra no relatorio: ja achatada, ja com o texto da norma
 * resolvido. O documento nao conhece entidade do TypeORM de proposito —
 * assim ele e uma funcao pura, testavel em milissegundos, do mesmo jeito
 * que `qualidade/dominio/`.
 */
export interface LinhaRelatorio {
  codigo: string;
  titulo: string;
  severidade: SeveridadeNc;
  status: StatusNc;
  norma: string | null;
  itemNorma: string | null;
  local: string | null;
  responsavel: string | null;
  abertaEm: Date;
  prazo: Date | null;
  fechadaEm: Date | null;
}

export interface CabecalhoRelatorio {
  titulo: string;
  tipo: TipoRelatorio;
  obraCodigo: string;
  obraNome: string;
  periodoInicio: string | null;
  periodoFim: string | null;
  geradoPor: string | null;
  geradoEm: Date;
}

export interface ResumoRelatorio {
  total: number;
  porSeveridade: Record<string, number>;
  porStatus: Record<string, number>;
  atrasadas: number;
  fechadas: number;
}

/**
 * Conta o que a capa do relatorio precisa mostrar.
 *
 * "Atrasada" e derivado (prazo vencido E status nao terminal), igual ao
 * resto do sistema — nunca um status gravado. `agora` e parametro para o
 * teste nao depender do relogio.
 */
export function resumir(linhas: LinhaRelatorio[], agora: Date): ResumoRelatorio {
  const porSeveridade: Record<string, number> = {};
  const porStatus: Record<string, number> = {};
  let atrasadas = 0;
  let fechadas = 0;

  for (const linha of linhas) {
    porSeveridade[linha.severidade] = (porSeveridade[linha.severidade] ?? 0) + 1;
    porStatus[linha.status] = (porStatus[linha.status] ?? 0) + 1;

    const terminal = linha.status === StatusNc.RESOLVIDA || linha.status === StatusNc.CANCELADA;
    if (terminal) fechadas += 1;
    if (!terminal && linha.prazo !== null && linha.prazo < agora) atrasadas += 1;
  }

  return { total: linhas.length, porSeveridade, porStatus, atrasadas, fechadas };
}

/**
 * Ordem de apresentacao: severidade decrescente, depois a mais antiga
 * primeiro. E o que um auditor espera abrir e ver — o problema mais grave
 * e mais velho no topo, nao a ordem de insercao no banco.
 *
 * Determinismo importa mais aqui do que em qualquer outra ordenacao do
 * projeto: a ordem vira `relatorio_item.ordem`, que e persistido, e o
 * documento gerado e hasheado. Duas geracoes do mesmo conjunto precisam
 * produzir byte a byte o mesmo arquivo, ou a verificacao de integridade
 * perde o sentido. Por isso o desempate final e pelo codigo, que e unico.
 */
const PESO_SEVERIDADE: Record<SeveridadeNc, number> = {
  [SeveridadeNc.CRITICA]: 0,
  [SeveridadeNc.ALTA]: 1,
  [SeveridadeNc.MEDIA]: 2,
  [SeveridadeNc.BAIXA]: 3,
};

export function ordenar(linhas: LinhaRelatorio[]): LinhaRelatorio[] {
  return [...linhas].sort((a, b) => {
    const porSeveridade = PESO_SEVERIDADE[a.severidade] - PESO_SEVERIDADE[b.severidade];
    if (porSeveridade !== 0) return porSeveridade;

    const porData = a.abertaEm.getTime() - b.abertaEm.getTime();
    if (porData !== 0) return porData;

    return a.codigo.localeCompare(b.codigo);
  });
}

/**
 * Escapa para HTML. O titulo e a descricao da NC sao texto livre digitado
 * pelo engenheiro; sem isto, um titulo com `<script>` vira script no
 * documento arquivado — que e justamente o artefato que alguem vai abrir
 * meses depois, fora de qualquer contexto de confianca.
 */
export function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** ISO curto e estavel (UTC). Nunca `toLocaleString`: muda com a locale da maquina e quebraria o hash. */
function data(valor: Date | null): string {
  return valor ? valor.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—';
}

function celula(valor: string | null): string {
  return escaparHtml(valor ?? '—');
}

/**
 * Renderiza o documento arquivavel.
 *
 * HTML autocontido, e nao PDF, por uma razao pratica: nenhuma biblioteca de
 * PDF entra no `package.json` so para isto, e o navegador imprime este
 * arquivo em PDF com fidelidade (ha `@media print` abaixo). O que o PBQP-H
 * exige e o CONTEUDO rastreavel e integro — o hash SHA-256 do arquivo e a
 * cadeia de custodia valem igual em HTML.
 *
 * PURA e DETERMINISTICA: mesma entrada, mesmos bytes. Nao chama `new Date()`
 * nem `Math.random()` — tudo o que varia entra por parametro.
 */
export function renderizarDocumento(
  cabecalho: CabecalhoRelatorio,
  linhas: LinhaRelatorio[],
  resumo: ResumoRelatorio,
): string {
  const periodo =
    cabecalho.periodoInicio && cabecalho.periodoFim
      ? `${cabecalho.periodoInicio} a ${cabecalho.periodoFim}`
      : 'Sem recorte de periodo';

  const severidades = Object.entries(resumo.porSeveridade)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([chave, valor]) => `<li><b>${escaparHtml(chave)}</b>: ${valor}</li>`)
    .join('');

  const statuses = Object.entries(resumo.porStatus)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([chave, valor]) => `<li><b>${escaparHtml(chave)}</b>: ${valor}</li>`)
    .join('');

  const corpo = linhas.length
    ? linhas
        .map((linha, indice) => {
          const terminal = linha.status === StatusNc.RESOLVIDA || linha.status === StatusNc.CANCELADA;
          const atrasada = !terminal && linha.prazo !== null && linha.prazo < cabecalho.geradoEm;
          return `<tr class="sev-${escaparHtml(linha.severidade)}">
      <td>${indice + 1}</td>
      <td class="mono">${escaparHtml(linha.codigo)}</td>
      <td>${escaparHtml(linha.titulo)}</td>
      <td>${escaparHtml(linha.severidade)}</td>
      <td>${escaparHtml(linha.status)}${atrasada ? ' <span class="atraso">ATRASADA</span>' : ''}</td>
      <td>${celula(linha.norma)}${linha.itemNorma ? ` — ${escaparHtml(linha.itemNorma)}` : ''}</td>
      <td>${celula(linha.local)}</td>
      <td>${celula(linha.responsavel)}</td>
      <td>${data(linha.abertaEm)}</td>
      <td>${data(linha.prazo)}</td>
      <td>${data(linha.fechadaEm)}</td>
    </tr>`;
        })
        .join('\n')
    : `<tr><td colspan="11" class="vazio">Nenhuma nao conformidade no recorte deste relatorio.</td></tr>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${escaparHtml(cabecalho.titulo)}</title>
<style>
  :root { color-scheme: light; }
  body { font: 13px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; color: #16202c; margin: 32px; background: #fff; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #5a6a7d; margin-bottom: 20px; }
  .meta { display: flex; flex-wrap: wrap; gap: 28px; padding: 14px 16px; background: #f4f7fa; border: 1px solid #dbe4ee; border-radius: 6px; margin-bottom: 20px; }
  .meta div { min-width: 150px; }
  .rotulo { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #6b7c90; }
  ul { list-style: none; padding: 0; margin: 6px 0 0; display: flex; gap: 16px; flex-wrap: wrap; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid #dbe4ee; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #eef3f8; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
  .atraso { color: #b3261e; font-weight: 700; font-size: 11px; }
  .vazio { text-align: center; color: #6b7c90; padding: 24px; }
  .sev-CRITICA td:nth-child(4) { color: #b3261e; font-weight: 700; }
  .sev-ALTA td:nth-child(4) { color: #b25000; font-weight: 600; }
  footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #dbe4ee; color: #6b7c90; font-size: 11px; }
  @media print { body { margin: 0; } .meta { break-inside: avoid; } tr { break-inside: avoid; } }
</style>
</head>
<body>
<h1>${escaparHtml(cabecalho.titulo)}</h1>
<p class="sub">${escaparHtml(cabecalho.obraCodigo)} — ${escaparHtml(cabecalho.obraNome)}</p>

<section class="meta">
  <div><span class="rotulo">Tipo</span>${escaparHtml(cabecalho.tipo)}</div>
  <div><span class="rotulo">Periodo</span>${escaparHtml(periodo)}</div>
  <div><span class="rotulo">Gerado por</span>${celula(cabecalho.geradoPor)}</div>
  <div><span class="rotulo">Gerado em</span>${data(cabecalho.geradoEm)}</div>
</section>

<section>
  <span class="rotulo">Total de nao conformidades</span> <b>${resumo.total}</b>
  &nbsp;·&nbsp; fechadas: <b>${resumo.fechadas}</b>
  &nbsp;·&nbsp; atrasadas: <b>${resumo.atrasadas}</b>
  <ul>${severidades}</ul>
  <ul>${statuses}</ul>
</section>

<h2 style="font-size:14px;margin:22px 0 8px">Nao conformidades</h2>
<table>
  <thead><tr>
    <th>#</th><th>Codigo</th><th>Titulo</th><th>Severidade</th><th>Status</th>
    <th>Norma</th><th>Local</th><th>Responsavel</th><th>Aberta em</th><th>Prazo</th><th>Fechada em</th>
  </tr></thead>
  <tbody>
${corpo}
  </tbody>
</table>

<footer>
  Documento gerado pelo Perceptra a partir dos registros de qualidade da obra.
  A integridade deste arquivo pode ser conferida pelo SHA-256 registrado no sistema
  (GET /relatorios/{id}/integridade), que recalcula o hash a partir do arquivo armazenado.
</footer>
</body>
</html>
`;
}
