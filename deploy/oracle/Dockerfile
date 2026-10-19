# syntax=docker/dockerfile:1
# Build natively on the ARM host; Node and PostgreSQL supply arm64 images/packages.
FROM node:22-bookworm-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl --fail --silent --show-error --location https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core postgresql-client-16 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
# tsx is currently a devDependency but is required by npm start and db scripts.
# Native sharp dependencies are selected for the build host (linux/arm64 on Oracle).
RUN npm ci --include=dev --no-audit --no-fund
COPY src ./src
COPY server ./server
COPY scripts ./scripts
COPY db ./db
COPY content ./content
COPY public ./public
COPY index.html tsconfig.json vite.config.ts ./
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3100 \
    DATA_DIR=/app/data \
    PG_BIN=/usr/lib/postgresql/16/bin
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/data /app/backups /app/.local \
    && chown node:node /app/data /app/backups /app/.local
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3100/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["npm", "start"]
