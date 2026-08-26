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

# VERIFIED, and the three things that had to be fixed to get here.
#
# This mount was written for a credential that lived in an .npmrc auth line,
# moved to ~/.bunfig.toml, and then sat unexercised because NO DOCKER BUILD
# COULD RUN: `./db/` is bind-mounted by docker-compose.dev.yml as the Postgres
# data directory, so the build context sender hit a root-owned directory and
# failed before reaching this line. See .dockerignore for that, and for the
# 1.5 GB of vendored Rust artifacts the context was also carrying.
#
#   1. HOME really is /root in oven/bun:1-alpine — checked, not assumed
#      (`docker run --rm oven/bun:1-alpine sh -c 'echo $HOME'`), so this target
#      path is the one bun reads.
#   2. `.config/wordlists` did not exist and nothing in the repo references a
#      wordlist, so the runner stage's COPY of it failed. Removed.
#   3. `--frozen-lockfile`, because a published image must install what the
#      lockfile says rather than whatever resolves that day.
#
# A BuildKit secret rather than an ARG is not in doubt: an ARG's value is
# recorded in the image history and `docker history` prints it, and this image
# publishes to ghcr.io/mindcollaps/calendry — a real leak, not a theoretical
# one. A secret mount leaves nothing in any layer.
#
#   docker build --secret id=bunfig,src=$HOME/.bunfig.toml -f .config/Dockerfile .
#
RUN --mount=type=secret,id=bunfig,target=/root/.bunfig.toml \
    bun install --frozen-lockfile

COPY . .
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" bun run prisma generate && bun run prepare && node node_modules/nuxt/bin/nuxt.mjs build


FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN apk add --no-cache wget

# bun, for ONE reason: `prisma db seed` executes the command in
# prisma.config.js, which is `bun run prisma/seed.ts`. The runner is a node
# image, so without this the entrypoint's second step — the step that loads the
# permission catalogue — fails, and a migrated-but-unseeded database is
# deliberately unusable (provisioning a tenant against it fails on a foreign
# key). The alternative was a node-shaped seed command for the image only, i.e.
# a second definition of the seed that could drift from the one every developer
# runs.
COPY --from=oven/bun:1-alpine /usr/local/bin/bun /usr/local/bin/bun

# THE MIGRATION TOOLCHAIN, and why it is installed rather than copied.
#
# `npm install -g prisma` was wrong twice over. It resolves "latest" on build
# day, so the migration engine drifts away from the `prisma@^7.8.0` the schema
# and the generated client were built against — an unpinned CLI against a pinned
# schema. And it does not work at all: `prisma.config.js` sits in /app and
# imports `prisma/config`, which a global install cannot satisfy, so
# `migrate deploy` died with "Cannot find module 'prisma/config'".
#
# Cherry-picking `node_modules/prisma` + `node_modules/@prisma` out of the
# builder was the next attempt and also fails: `@prisma/config` requires
# `effect`, which is a transitive dependency outside the @prisma scope. There is
# no small hand-picked set — the CLI needs its real dependency tree.
#
# So npm resolves it, at the RANGES THIS REPO DECLARES rather than at latest.
# Read from package.json so there is no second place to update. This installs
# the CLI, the client and the pg adapter only — not nuxt, not vue: the server
# bundle in .output is already self-contained, and this tree exists purely for
# the two entrypoint steps.
COPY --chown=app:app package.json ./package.json

# Installed against a MINIMAL manifest, generated from the real one.
#
# `npm install prisma@…` with the project's package.json in place resolves the
# whole application graph — it failed with ERESOLVE on a nitro/vite peer
# conflict, and had it succeeded it would have installed nuxt and vue into an
# image whose server bundle already contains them. So the manifest is reduced to
# the three packages the entrypoint actually needs, with the RANGES THIS REPO
# DECLARES carried across rather than re-pinned by hand.
#
# `type: module` is preserved deliberately: prisma.config.js is ESM with a
# top-level await, and without it node parses the config as CommonJS and fails.
#
# A side benefit worth keeping: the shipped manifest now describes what is
# actually installed, instead of listing dependencies this image does not carry.
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

# `prisma db seed` runs prisma/seed.ts, which reaches OUTSIDE prisma/: it imports
# `shared/permissions` (the permission catalogue is code, mirrored into the
# table by the seed) and `scripts/lib/ownerDatabaseUrl` (the host-vs-container
# database URL selection). Without these the seed fails on an unresolved import
# after migrations have already run — the worst place to fail, because the
# schema is then live and the reference data is not.
COPY --chown=app:app shared ./shared
COPY --chown=app:app scripts/lib ./scripts/lib
COPY --chown=app:app package.json ./package.json
# The generated client the seed imports. Generated HERE rather than copied from
# the builder, so the client and the @prisma/client that resolves it come from
# one install and cannot disagree about their engine version. The dummy URL is
# only to satisfy config loading; generation reads the schema, not the database.
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" \
    MIGRATION_DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" \
    prisma generate

COPY --chown=app:app .config/entrypoint.sh ./entrypoint.sh

RUN chmod +x ./entrypoint.sh

USER app

EXPOSE 3000

CMD ["./entrypoint.sh"]
