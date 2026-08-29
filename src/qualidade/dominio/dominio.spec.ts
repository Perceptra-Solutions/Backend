import { describe, expect, it } from 'vitest';

import {
  OrigemRegistro,
  SeveridadeNc,
  StatusNc,
  StatusTriagem,
} from '../../shared/enums/dominio.enums.js';
import { SegregacaoFuncaoError } from '../../shared/erros/segregacao-funcao.error.js';
import { TransicaoInvalidaError } from '../../shared/erros/transicao-invalida.error.js';
import {
  ehTerminal,
  estaAtrasada,
  exigirTransicaoValida,
  fechamentoPara,
  podeTransicionar,
} from './nc-status.maquina.js';
import { calcularPrazo, prazoDaAcaoEhValido, prazoAposReprovacao } from './politica-prazo.js';
import {
  exigirCoerenciaDeOrigem,
  exigirDeteccaoConfirmada,
  exigirTriagemPermitida,
} from './regra-origem.js';
import { exigirSegregacaoDeFuncao, podeVerificar } from './segregacao-funcao.policy.js';

/**
 * Dominio puro: sem Nest, sem banco, sem I/O. Estes testes rodam em
 * milissegundos e sao a rede que protege as regras que definem o desafio.
 */
describe('Maquina de estados da NC', () => {
  it('permite o caminho feliz inteiro', () => {
    expect(podeTransicionar(StatusNc.ABERTA, StatusNc.EM_CORRECAO)).toBe(true);
    expect(podeTransicionar(StatusNc.EM_CORRECAO, StatusNc.AGUARDANDO_VERIFICACAO)).toBe(true);
    expect(podeTransicionar(StatusNc.AGUARDANDO_VERIFICACAO, StatusNc.RESOLVIDA)).toBe(true);
  });

  it('permite o retorno da verificacao REPROVADA — a transicao mais esquecida', () => {
    expect(podeTransicionar(StatusNc.AGUARDANDO_VERIFICACAO, StatusNc.EM_CORRECAO)).toBe(true);
  });

  it.each([
    [StatusNc.ABERTA, StatusNc.RESOLVIDA, 'fecharia NC sem acao nem verificacao'],
    [StatusNc.ABERTA, StatusNc.AGUARDANDO_VERIFICACAO, 'nao ha correcao a verificar'],
    [StatusNc.EM_CORRECAO, StatusNc.RESOLVIDA, 'pularia a segregacao de funcao'],
    [StatusNc.EM_CORRECAO, StatusNc.ABERTA, 'a acao ja existe; voltar nao faz sentido'],
    [StatusNc.AGUARDANDO_VERIFICACAO, StatusNc.ABERTA, 'idem'],
  ])('recusa %s -> %s (%s)', (de, para) => {
    expect(podeTransicionar(de, para)).toBe(false);
    expect(() => exigirTransicaoValida(de, para)).toThrow(TransicaoInvalidaError);
  });

  it.each([StatusNc.RESOLVIDA, StatusNc.CANCELADA])('trata %s como terminal, sem saida', (terminal) => {
    expect(ehTerminal(terminal)).toBe(true);
    for (const destino of Object.values(StatusNc)) {
      if (destino === terminal) continue;
      expect(podeTransicionar(terminal, destino)).toBe(false);
    }
  });

  it('trata transicao para o mesmo estado como no-op idempotente', () => {
    // Duplo clique no front nao deve virar 422.
    for (const status of Object.values(StatusNc)) {
      expect(podeTransicionar(status, status)).toBe(true);
    }
  });

  it('explica o motivo na mensagem do erro, com as transicoes validas', () => {
    try {
      exigirTransicaoValida(StatusNc.EM_CORRECAO, StatusNc.RESOLVIDA);
      expect.unreachable('deveria ter lancado');
    } catch (e) {
      const erro = e as TransicaoInvalidaError;
      expect(erro.codigo).toBe('NC_TRANSICAO_INVALIDA');
      expect(erro.message).toContain('AGUARDANDO_VERIFICACAO');
    }
  });

  it('diz que estado terminal nao tem saida, em vez de listar transicoes vazias', () => {
    try {
      exigirTransicaoValida(StatusNc.RESOLVIDA, StatusNc.EM_CORRECAO);
      expect.unreachable('deveria ter lancado');
    } catch (e) {
      expect((e as Error).message).toContain('estado terminal');
    }
  });

  describe('atraso e derivado, nao e status', () => {
    const ontem = new Date('2026-08-28T00:00:00Z');
    const agora = new Date('2026-08-29T00:00:00Z');

    it('marca como atrasada a NC ativa com prazo vencido', () => {
      expect(estaAtrasada(StatusNc.ABERTA, ontem, agora)).toBe(true);
      expect(estaAtrasada(StatusNc.EM_CORRECAO, ontem, agora)).toBe(true);
    });

    it('nunca marca NC terminal como atrasada, mesmo com prazo vencido', () => {
      expect(estaAtrasada(StatusNc.RESOLVIDA, ontem, agora)).toBe(false);
      expect(estaAtrasada(StatusNc.CANCELADA, ontem, agora)).toBe(false);
    });

    it('nao marca NC sem prazo', () => {
      expect(estaAtrasada(StatusNc.ABERTA, null, agora)).toBe(false);
    });
  });

  describe('fechada_em corresponde ao estado terminal', () => {
    const quando = new Date('2026-08-29T10:00:00Z');

    it('carimba em estado terminal', () => {
      expect(fechamentoPara(StatusNc.RESOLVIDA, quando)).toEqual(quando);
      expect(fechamentoPara(StatusNc.CANCELADA, quando)).toEqual(quando);
    });

    it('deixa nulo fora de estado terminal — inclusive em AGUARDANDO_VERIFICACAO', () => {
      // Carimbar aqui e o erro que estraga o MTTR: a NC ainda nao fechou.
      expect(fechamentoPara(StatusNc.AGUARDANDO_VERIFICACAO, quando)).toBeNull();
      expect(fechamentoPara(StatusNc.EM_CORRECAO, quando)).toBeNull();
      expect(fechamentoPara(StatusNc.ABERTA, quando)).toBeNull();
    });
  });
});

describe('Politica de prazo', () => {
  const abertura = new Date('2026-08-29T12:00:00Z');
  const horas = (d: Date) => (d.getTime() - abertura.getTime()) / 3_600_000;

  it.each([
    [SeveridadeNc.CRITICA, 24],
    [SeveridadeNc.ALTA, 72],
    [SeveridadeNc.MEDIA, 168],
    [SeveridadeNc.BAIXA, 360],
  ])('deriva %s em %ih a partir da abertura', (severidade, esperado) => {
    expect(horas(calcularPrazo(severidade, abertura))).toBe(esperado);
  });

  it('nao estende o prazo quando a verificacao reprova', () => {
    // A obra nao ganha tempo extra por ter feito a correcao errada. E o que
    // torna o indicador de atraso honesto.
    const prazo = calcularPrazo(SeveridadeNc.ALTA, abertura);
    expect(prazoAposReprovacao(prazo)).toEqual(prazo);
  });

  describe('prazo da acao contra o SLA da NC', () => {
    const prazoNc = calcularPrazo(SeveridadeNc.ALTA, abertura);

    it('aceita acao que termina dentro do SLA', () => {
      expect(prazoDaAcaoEhValido(new Date(abertura.getTime() + 3_600_000), prazoNc)).toBe(true);
    });

    it('recusa acao que ultrapassa o SLA', () => {
      expect(prazoDaAcaoEhValido(new Date(prazoNc.getTime() + 1), prazoNc)).toBe(false);
    });

    it('aceita quando algum dos dois nao tem prazo', () => {
      expect(prazoDaAcaoEhValido(null, prazoNc)).toBe(true);
      expect(prazoDaAcaoEhValido(prazoNc, null)).toBe(true);
    });
  });
});

describe('Segregacao de funcao', () => {
  const ana = 'a1111111-1111-1111-1111-111111111111';
  const bruno = 'b2222222-2222-2222-2222-222222222222';

  it('impede o executor de verificar a propria acao', () => {
    expect(podeVerificar(ana, ana)).toBe(false);
    expect(() => exigirSegregacaoDeFuncao(ana, ana)).toThrow(SegregacaoFuncaoError);
  });

  it('libera outro engenheiro', () => {
    expect(podeVerificar(ana, bruno)).toBe(true);
    expect(() => exigirSegregacaoDeFuncao(ana, bruno)).not.toThrow();
  });

  it('devolve codigo estavel para o front chavear', () => {
    try {
      exigirSegregacaoDeFuncao(ana, ana);
      expect.unreachable('deveria ter lancado');
    } catch (e) {
      const erro = e as SegregacaoFuncaoError;
      expect(erro.codigo).toBe('SEGREGACAO_FUNCAO_VIOLADA');
      expect(erro.status).toBe(422);
    }
  });
});

describe('Regras de origem', () => {
  it('exige deteccao quando a origem e IA', () => {
    expect(() => exigirCoerenciaDeOrigem(OrigemRegistro.IA, null)).toThrow(
      /origem IA precisa apontar/i,
    );
    expect(() => exigirCoerenciaDeOrigem(OrigemRegistro.IA, 'uuid')).not.toThrow();
  });

  it('proibe deteccao quando a origem e MANUAL', () => {
    expect(() => exigirCoerenciaDeOrigem(OrigemRegistro.MANUAL, 'uuid')).toThrow(
      /MANUAL nao pode ter deteccao/i,
    );
    expect(() => exigirCoerenciaDeOrigem(OrigemRegistro.MANUAL, null)).not.toThrow();
  });

  it('so deixa deteccao CONFIRMADA virar NC', () => {
    expect(() => exigirDeteccaoConfirmada(StatusTriagem.CONFIRMADA)).not.toThrow();

    for (const status of [
      StatusTriagem.PENDENTE,
      StatusTriagem.FALSO_POSITIVO,
      StatusTriagem.DUPLICADA,
    ]) {
      expect(() => exigirDeteccaoConfirmada(status)).toThrow(/nao pode originar/i);
    }
  });

  it('nao deixa a triagem voltar para PENDENTE', () => {
    expect(() =>
      exigirTriagemPermitida(StatusTriagem.CONFIRMADA, StatusTriagem.PENDENTE, false),
    ).toThrow(/nao volta para PENDENTE/i);
  });

  it('nao deixa retriar deteccao que ja gerou NC', () => {
    expect(() =>
      exigirTriagemPermitida(StatusTriagem.CONFIRMADA, StatusTriagem.FALSO_POSITIVO, true),
    ).toThrow(/ja gerou uma nao conformidade/i);
  });

  it('deixa retriar enquanto nao houver NC', () => {
    expect(() =>
      exigirTriagemPermitida(StatusTriagem.CONFIRMADA, StatusTriagem.FALSO_POSITIVO, false),
    ).not.toThrow();
  });
});
