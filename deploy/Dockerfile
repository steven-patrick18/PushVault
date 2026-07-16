# PushVault production image: API + dashboard (served by the API) + snippet.
# Build from the repo root:  docker build -f deploy/Dockerfile --build-arg APP_BASE_URL=https://push.example.com .
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates git && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# install with a warm cache layer
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/snippet/package.json apps/snippet/
COPY apps/demo-site/package.json apps/demo-site/
# newer pnpm enforces minimumReleaseAge (rejects packages <24h old) — our
# lockfile is the trust source here, so disable the age check for CI builds
RUN echo "minimum-release-age=0" > .npmrc && pnpm install --frozen-lockfile

COPY . .

ARG APP_BASE_URL=http://localhost:3000
ENV APP_BASE_URL=$APP_BASE_URL
# the deployed commit, shown on the Updates page to compare against GitHub
ARG GIT_SHA=
ENV PUSHVAULT_COMMIT=$GIT_SHA

RUN cd apps/api && npx prisma generate
RUN pnpm --filter @pushvault/snippet build \
 && pnpm --filter @pushvault/dashboard build \
 && pnpm --filter @pushvault/api build

# ---------- runtime ----------
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# copy owned by the built-in unprivileged `node` user — the app runs as non-root
COPY --from=build --chown=node:node /app ./
ENV NODE_ENV=production
USER node
WORKDIR /app/apps/api
EXPOSE 3000
# migrations → align the RLS app-role password → start
CMD ["sh", "-c", "npx prisma migrate deploy && node scripts/set-app-password.mjs && node dist/main.js"]
