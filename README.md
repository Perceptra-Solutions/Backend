# Perceptra — Backend de Qualidade em Obra

Backend do Desafio 1 do Hackathon Construtech 2026 (PBQP-H / NBR 15575).

Fecha o ciclo: **câmera detecta → engenheiro tria → nasce a Não Conformidade → ação corretiva → verificação por outro engenheiro → painel de conformidade**, com evidência hasheada e norma no meio.

NestJS 12 · TypeScript 6 · ESM puro · TypeORM 1 · PostgreSQL 18

---

## Subir tudo

Requer apenas Docker.

```bash
docker compose up -d --build
```

Isso sobe o Postgres, espera ficar saudável, roda as migrations num container efêmero e só então sobe a API.

```bash
docker compose --profile seed run --rm seed
```

Popula os dados da demo. A API fica em <http://localhost:3000> e o Swagger em <http://localhost:3000/docs>.

| Comando | O que faz |
|---|---|
| `npm run docker:up` | build + sobe tudo |
| `npm run docker:seed` | popula os dados da demo |
| `npm run docker:logs` | acompanha o log da API |
| `npm run docker:down` | derruba (mantém o volume do banco) |
| `npm run docker:reset` | derruba **apagando o volume** e sobe do zero |

Usuários do seed (senha única `perceptra123`):

| E-mail | Papel |
|---|---|
| `gestora@perceptra.dev` | GESTOR |
| `ana@perceptra.dev` | ENGENHEIRO — executou a ação da NC resolvida |
| `bruno@perceptra.dev` | ENGENHEIRO — verificou a ação da Ana |

Ana e Bruno são pessoas diferentes de propósito: é essa separação que a demonstração da segregação de função usa.

---

## Desenvolvimento fora do container

O `.env` já aponta para o Postgres do container em `localhost:5432`, então dá para rodar a API na máquina com hot-reload e o banco no Docker:

```bash
docker compose up -d postgres
```

```bash
npm run start:dev
```

---

## Testes

```bash
npm test
```

53 testes, **sem precisar de banco nenhum**: as invariantes do schema rodam contra as migrations reais num PostgreSQL 18 em processo (PGlite). Funciona em qualquer máquina e no CI.

```bash
npm run test:e2e
```

Sobe a aplicação inteira contra o Postgres do container. Usa o banco `qualidade_obra_test`, nunca o de desenvolvimento — a suíte trunca tabelas. Crie-o uma vez:

```bash
docker compose exec postgres psql -U perceptra -d postgres -c "CREATE DATABASE qualidade_obra_test OWNER perceptra;"
```

```bash
docker compose run --rm -e DATABASE_URL="postgresql://perceptra:perceptra@postgres:5432/qualidade_obra_test" migracao
```

---

## Regras do projeto

Três coisas que, se ignoradas, destroem trabalho silenciosamente:

1. **Nunca `synchronize: true` no TypeORM.** Ele apaga CHECK, trigger e índice parcial sem avisar — e é neles que moram as invariantes do MER (segregação de função, imutabilidade da evidência, prazo por severidade).
2. **Nunca adicione plugin esbuild/swc ao Vitest.** O pipeline atual (Oxc) emite `emitDecoratorMetadata` corretamente; o esbuild não. Trocar quebra toda a injeção de dependência de uma vez, em todos os testes.
3. **Nunca use glob de entities** (`entities: ['dist/**/*.entity.js']`). Sob ESM no Windows o caminho vira `D:\...` e o loader do Node rejeita, lendo `D:` como protocolo. Use `autoLoadEntities: true` e a lista explícita em `src/database/entidades.ts`.

Outras convenções que o código assume:

- Todo import relativo termina em `.js`, mesmo apontando para um `.ts` (exigência do `moduleResolution: nodenext`). Arquivos gerados por `nest g` vêm sem — rode `npm run typecheck` depois.
- **Sem barrel files** (`index.ts`) em `src/`. Sob ESM um barril transforma ciclo de tipo, inofensivo, em ciclo de runtime com TDZ.
- Portas de injeção (`ArmazenamentoPort`) são `abstract class`, nunca `interface`: interface some no emit e o Nest não resolve o provider.
- Nenhum arquivo de `src/` lê `process.env` direto, exceto os factories de `registerAs` e o `data-source.ts` (que roda fora do Nest).

---

## Migrations

Rodam contra o **build**, não contra `.ts` — o `typeorm-ts-node-esm` depende de um ts-node que não conhece TypeScript 6 nem os loader hooks do Node 24.

```bash
npm run db:migrate
```

As migrations são escritas à mão. `migration:generate` não produz CHECK, trigger, índice parcial nem FK com política de delete — que é justamente o que carrega as regras de negócio aqui.

---

## Estrutura

```
src/
├─ config/          validação de env no boot (falha subindo, não na 1ª request)
├─ database/        DataSource, migrations, seed, mapeador de erro do Postgres
├─ shared/          contrato de erro, pipes, interceptors, middlewares
├─ armazenamento/   porta de storage (S3/R2 e disco local)
├─ auth/            JWT + guards de papel
├─ identidade/      usuario
├─ obras/           obra + local
├─ catalogo-ia/     modelo_ia + camera
├─ ingestao/        deteccao (lote) + triagem
├─ normas/          requisito_norma
├─ qualidade/       NÚCLEO — NC, ação corretiva, verificação, domínio puro
├─ evidencias/      upload, SHA-256 em streaming, cadeia de custódia
├─ relatorios/      relatório PBQP-H
├─ painel/          indicadores (read model)
└─ health/          liveness e readiness
```

O domínio em `src/qualidade/dominio/` é puro: sem Nest, sem TypeORM, sem I/O. A máquina de estados da NC e a segregação de função são funções testáveis em milissegundos.
