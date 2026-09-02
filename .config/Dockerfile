# syntax=docker/dockerfile:1
# The `syntax` line is required: the install step below uses a BuildKit secret
# mount, which the legacy builder does not understand.

FROM oven/bun:1-alpine AS builder

WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache nodejs

COPY package.json bun.lock tsconfig.json ./

# The preinstall guard runs before install, so it has to be in the image first.
COPY scripts/check-registry-auth.mjs ./scripts/

# A BuildKit secret, not an ARG: an ARG's value shows up in `docker history` on
# a published image. HOME is /root in oven/bun:1-alpine, so this is the path bun
# reads.
#
#   docker build --secret id=bunfig,src=$HOME/.bunfig.toml -f .config/Dockerfile .
RUN --mount=type=secret,id=bunfig,target=/root/.bunfig.toml \
    bun install --frozen-lockfile

COPY . .
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" bun run prisma generate && bun run prepare && node node_modules/nuxt/bin/nuxt.mjs build


# node 22: a @prisma/streams-local dependency declares node >=22.
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN apk add --no-cache curl

# `prisma db seed` runs `bun run prisma/seed.ts`, and this is a node image.
COPY --from=oven/bun:1-alpine /usr/local/bin/bun /usr/local/bin/bun

# The Prisma CLI, at the ranges package.json declares. `npm install -g prisma`
# cannot satisfy prisma.config.js's `import "prisma/config"`, and cherry-picking
# node_modules/@prisma out of the builder misses transitive deps like `effect`.
COPY --chown=app:app package.json ./package.json

# Against a minimal generated manifest: installing with the real package.json
# resolves the whole app graph (and fails on a nitro/vite peer conflict). Keep
# `type: module` because prisma.config.js is ESM with a top-level await.
RUN cp package.json /tmp/source-package.json \
    && node -e "const p = require('/tmp/source-package.json'); \
        require('fs').writeFileSync('package.json', JSON.stringify({ \
            name: 'calendry-runtime', \
            private: true, \
            type: 'module', \
            dependencies: { \
                prisma: p.dependencies.prisma, \
                '@prisma/client': p.dependencies['@prisma/client'], \
                '@prisma/adapter-pg': p.dependencies['@prisma/adapter-pg'], \
            }, \
        }, null, 2) + '\n')" \
    && npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force \
    && rm /tmp/source-package.json

# So the entrypoint's bare `prisma` resolves to this pinned CLI.
ENV PATH="/app/node_modules/.bin:${PATH}"

RUN addgroup -S app && adduser -S app -G app

RUN chown app:app /app

COPY --chown=app:app --from=builder /app/.output ./.output
COPY --chown=app:app --from=builder /app/public ./public
COPY --chown=app:app prisma ./prisma
COPY --chown=app:app prisma.config.js ./prisma.config.js

# prisma/seed.ts imports shared/permissions and scripts/lib/ownerDatabaseUrl.
COPY --chown=app:app shared ./shared
COPY --chown=app:app scripts ./scripts
# The operator CLIs (provision:tenant, reset:password, create:account) import
# hashPassword from here, the one server/ file they need, and self-contained
# (node:crypto only), so it comes without dragging in the rest of server/ or a
# bigger node_modules than the prisma-only install above provides.
COPY --chown=app:app server/utils/auth.ts ./server/utils/auth.ts
COPY --chown=app:app package.json ./package.json
# The generated client the seed imports. Reads the schema, not the database.
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" \
    MIGRATION_DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" \
    prisma generate

COPY --chown=app:app .config/entrypoint.sh ./entrypoint.sh

RUN chmod +x ./entrypoint.sh

USER app

EXPOSE 3000

CMD ["./entrypoint.sh"]
