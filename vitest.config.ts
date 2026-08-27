import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Vitest runs outside Nuxt, so Nuxt's aliases have to be redeclared here or
// imports fail at load time with a misleading "cannot find module".
export default defineConfig({
    test: {
        // Scoped to this repo: the default include sweeps in `.impeccable/`,
        // a vendored submodule with 93 tests of its own.
        include: ['tests/**/*.test.ts'],

        // The integration suites share one set of fixture ids and each
        // `beforeAll` re-seeds them, so in parallel they race on unique ids.
        fileParallelism: false,
    },
    resolve: {
        alias: {
            '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
            '~': fileURLToPath(new URL('./app', import.meta.url)),
        },
    },
});
