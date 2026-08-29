# =====================================================================
# Perceptra Backend — imagem de producao
#
# Node 24 porque o projeto usa ESM puro ("type": "module") com
# moduleResolution nodenext e top-level await no main.ts. O typeorm@1.1.0
# tambem declara engines node ">=24.11.0".
# =====================================================================

# ---------------------------------------------------------------- deps
FROM node:24.19.0-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./

# npm ci com o lockfile: build reproduzivel. --ignore-scripts porque a
# unica dependencia com install script neste projeto e @scarf/scarf
# (telemetria do TypeORM), que nao queremos rodar. bcryptjs e JS puro,
# entao nao ha addon nativo a compilar aqui — foi por isso que ele foi
# escolhido em vez de bcrypt/argon2.
RUN npm ci --ignore-scripts --no-audit --no-fund

# --------------------------------------------------------------- build
FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

RUN npm run build

# Remove as devDependencies do node_modules que vai para a imagem final.
RUN npm prune --omit=dev --ignore-scripts

# ------------------------------------------------------------- runtime
FROM node:24.19.0-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# curl para o HEALTHCHECK. tini para virar PID 1 e repassar SIGTERM ao
# Node — sem isso o enableShutdownHooks() do Nest nunca dispara e o pool
# do Postgres fica pendurado a cada deploy.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl tini \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

# O diretorio de arquivos temporarios do upload de evidencia. Com
# EVIDENCIA_STORAGE_DRIVER=local o storage tambem mora aqui e deve ser
# um volume — senao a evidencia morre junto com o container.
RUN mkdir -p /app/storage/tmp /app/storage/evidencias && chown -R node:node /app/storage

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
