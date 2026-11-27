# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=npm,target=/root/.npm npm ci
FROM deps AS build
COPY . .
ARG APP_URL=http://43.143.85.207:8082
# Non-secret placeholders only: page rendering must not require production services.
RUN APP_URL=$APP_URL DATABASE_URL=postgresql://build:build@127.0.0.1/build BETTER_AUTH_SECRET=build-placeholder-secret-at-least-32-characters npm run build
RUN ./node_modules/.bin/esbuild scripts/worker.ts --bundle --platform=node --format=esm --packages=external --alias:next/server=next/server.js --outfile=worker.mjs
RUN ./node_modules/.bin/esbuild scripts/migrate.ts --bundle --platform=node --format=esm --packages=external --alias:next/server=next/server.js --outfile=migrate.mjs
FROM base AS production-deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=npm,target=/root/.npm npm ci --omit=dev
FROM base AS runner
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/worker.mjs /app/migrate.mjs ./
COPY --from=build --chown=node:node /app/db ./db
RUN node --conditions=react-server worker.mjs --check
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
