# syntax=docker/dockerfile:1
FROM node:26-alpine AS base
# Node 25+ no longer bundles Corepack.
RUN npm install -g pnpm@12.4.1 && npm cache clean --force
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages ./packages
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
# Placeholders satisfy route analysis at build time; real values are validated when the server starts.
RUN DATABASE_URL=postgres://build@localhost/build BETTER_AUTH_SECRET=build-placeholder pnpm build && pnpm prune --prod

FROM base AS runtime
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 PROTOCOL_HEADER=x-forwarded-proto
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/package.json ./
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
EXPOSE 3000
USER node
CMD ["sh", "-c", "node scripts/migrate.ts && node scripts/server.ts"]
