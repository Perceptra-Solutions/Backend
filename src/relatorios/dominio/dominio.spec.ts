import { describe, expect, it } from 'vitest';

import { SeveridadeNc, StatusNc, TipoRelatorio } from '../../shared/enums/dominio.enums.js';
import {
  escaparHtml,
  ordenar,
  renderizarDocumento,
  resumir,
  type CabecalhoRelatorio,
  type LinhaRelatorio,
} from './documento-relatorio.js';

const AGORA = new Date('2026-08-29T12:00:00.000Z');

function linha(sobrescreve: Partial<LinhaRelatorio> = {}): LinhaRelatorio {
  return {
    codigo: 'NC-2026-000001',
    titulo: 'Infiltracao no rodape',
    severidade: SeveridadeNc.MEDIA,
    status: StatusNc.ABERTA,
    norma: 'NBR 15575',
    itemNorma: 'Parte 3 - 11.2',
    local: 'Torre A',
    responsavel: 'Ana Ribeiro',
    abertaEm: new Date('2026-08-01T10:00:00.000Z'),
    prazo: new Date('2026-09-30T10:00:00.000Z'),
    fechadaEm: null,
    ...sobrescreve,
  };
}

const cabecalho: CabecalhoRelatorio = {
  titulo: 'Relatorio de teste',
  tipo: TipoRelatorio.OBRA,
  obraCodigo: 'OB-2026-001',
  obraNome: 'Residencial Aurora',
  periodoInicio: null,
  periodoFim: null,
  geradoPor: 'Gestora',
  geradoEm: AGORA,
};

describe('resumir', () => {
  it('conta por severidade e por status', () => {
    const resumo = resumir(
      [
        linha({ severidade: SeveridadeNc.CRITICA }),
        linha({ severidade: SeveridadeNc.CRITICA }),
        linha({ severidade: SeveridadeNc.BAIXA, status: StatusNc.EM_CORRECAO }),
      ],
      AGORA,
    );

    expect(resumo.total).toBe(3);
    expect(resumo.porSeveridade).toEqual({ CRITICA: 2, BAIXA: 1 });
    expect(resumo.porStatus).toEqual({ ABERTA: 2, EM_CORRECAO: 1 });
  });

  it('conta como atrasada a NC com prazo vencido que ainda nao fechou', () => {
    const resumo = resumir([linha({ prazo: new Date('2026-08-01T00:00:00.000Z') })], AGORA);
    expect(resumo.atrasadas).toBe(1);
  });

  // "Atrasada" e derivado do prazo E do status: uma NC ja resolvida nao
  // fica atrasada retroativamente so porque fechou depois do prazo. Contar
  // assim inflaria o indicador de atraso justamente com o trabalho que foi
  // concluido.
  it('nao conta como atrasada a NC ja resolvida, mesmo com prazo no passado', () => {
    const resumo = resumir(
      [
        linha({
          status: StatusNc.RESOLVIDA,
          prazo: new Date('2026-08-01T00:00:00.000Z'),
          fechadaEm: new Date('2026-08-15T00:00:00.000Z'),
        }),
      ],
      AGORA,
    );

    expect(resumo.atrasadas).toBe(0);
    expect(resumo.fechadas).toBe(1);
  });

  it('cancelada conta como fechada, nunca como atrasada', () => {
    const resumo = resumir(
      [linha({ status: StatusNc.CANCELADA, prazo: new Date('2026-01-01T00:00:00.000Z') })],
      AGORA,
    );
    expect(resumo).toMatchObject({ fechadas: 1, atrasadas: 0 });
  });

  it('NC sem prazo nunca e atrasada', () => {
    expect(resumir([linha({ prazo: null })], AGORA).atrasadas).toBe(0);
  });
});

describe('ordenar', () => {
  it('poe a severidade mais grave primeiro', () => {
    const ordenadas = ordenar([
      linha({ codigo: 'NC-3', severidade: SeveridadeNc.BAIXA }),
      linha({ codigo: 'NC-1', severidade: SeveridadeNc.CRITICA }),
      linha({ codigo: 'NC-2', severidade: SeveridadeNc.ALTA }),
    ]);

    expect(ordenadas.map((l) => l.codigo)).toEqual(['NC-1', 'NC-2', 'NC-3']);
  });

  it('dentro da mesma severidade, a mais antiga vem antes', () => {
    const ordenadas = ordenar([
      linha({ codigo: 'NC-nova', abertaEm: new Date('2026-08-20T00:00:00.000Z') }),
      linha({ codigo: 'NC-velha', abertaEm: new Date('2026-08-02T00:00:00.000Z') }),
    ]);

    expect(ordenadas.map((l) => l.codigo)).toEqual(['NC-velha', 'NC-nova']);
  });

  // A ordem vira `relatorio_item.ordem`, que e persistido, e o documento e
  // hasheado. Sem desempate total, duas geracoes do mesmo conjunto poderiam
  // produzir arquivos diferentes e a verificacao de integridade perderia o
  // sentido.
  it('desempata pelo codigo para a ordem ser totalmente deterministica', () => {
    const mesmaData = new Date('2026-08-10T00:00:00.000Z');
    const entrada = [
      linha({ codigo: 'NC-B', abertaEm: mesmaData }),
      linha({ codigo: 'NC-A', abertaEm: mesmaData }),
      linha({ codigo: 'NC-C', abertaEm: mesmaData }),
    ];

    expect(ordenar(entrada).map((l) => l.codigo)).toEqual(['NC-A', 'NC-B', 'NC-C']);
    // Embaralhar a entrada nao pode mudar a saida.
    expect(ordenar([...entrada].reverse()).map((l) => l.codigo)).toEqual(['NC-A', 'NC-B', 'NC-C']);
  });

  it('nao altera o array recebido', () => {
    const entrada = [linha({ codigo: 'NC-2' }), linha({ codigo: 'NC-1' })];
    ordenar(entrada);
    expect(entrada.map((l) => l.codigo)).toEqual(['NC-2', 'NC-1']);
  });
});

describe('escaparHtml', () => {
  it('neutraliza script vindo do titulo digitado pelo engenheiro', () => {
    expect(escaparHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('escapa o & antes dos demais, sem escapar duas vezes', () => {
    expect(escaparHtml('a & b')).toBe('a &amp; b');
    expect(escaparHtml('<a href="x">')).toBe('&lt;a href=&quot;x&quot;&gt;');
  });
});

describe('renderizarDocumento', () => {
  it('e deterministico: a mesma entrada gera exatamente os mesmos bytes', () => {
    const linhas = ordenar([linha({ codigo: 'NC-1' }), linha({ codigo: 'NC-2' })]);
    const resumo = resumir(linhas, AGORA);

    const a = renderizarDocumento(cabecalho, linhas, resumo);
    const b = renderizarDocumento(cabecalho, linhas, resumo);

    expect(a).toBe(b);
  });

  it('inclui codigo, norma e responsavel de cada NC', () => {
    const linhas = [linha()];
    const html = renderizarDocumento(cabecalho, linhas, resumir(linhas, AGORA));

    expect(html).toContain('NC-2026-000001');
    expect(html).toContain('NBR 15575');
    expect(html).toContain('Ana Ribeiro');
    expect(html).toContain('Residencial Aurora');
  });

  it('marca visualmente a NC atrasada', () => {
    const linhas = [linha({ prazo: new Date('2026-08-01T00:00:00.000Z') })];
    const html = renderizarDocumento(cabecalho, linhas, resumir(linhas, AGORA));
    expect(html).toContain('ATRASADA');
  });

  it('escapa o titulo da NC no corpo do documento', () => {
    const linhas = [linha({ titulo: '<img src=x onerror=alert(1)>' })];
    const html = renderizarDocumento(cabecalho, linhas, resumir(linhas, AGORA));

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('rende um documento valido mesmo sem nenhuma NC', () => {
    const html = renderizarDocumento(cabecalho, [], resumir([], AGORA));

    expect(html).toContain('Nenhuma nao conformidade');
    expect(html).toContain('<!doctype html>');
  });

  it('mostra o periodo quando o relatorio e periodico', () => {
    const html = renderizarDocumento(
      { ...cabecalho, tipo: TipoRelatorio.PERIODICO, periodoInicio: '2026-08-01', periodoFim: '2026-08-31' },
      [],
      resumir([], AGORA),
    );

    expect(html).toContain('2026-08-01 a 2026-08-31');
  });

  // Datas em ISO/UTC, nunca toLocaleString: a locale da maquina que gera
  // mudaria os bytes e, com eles, o hash do arquivo.
  it('formata data em UTC, independente da locale da maquina', () => {
    const linhas = [linha({ abertaEm: new Date('2026-08-01T10:00:00.000Z') })];
    const html = renderizarDocumento(cabecalho, linhas, resumir(linhas, AGORA));
    expect(html).toContain('2026-08-01 10:00 UTC');
  });
});
