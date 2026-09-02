import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Vitest runs outside Nuxt, so Nuxt's aliases have to be redeclared here or
// imports fail at load time with a misleading "cannot find module".
export default defineConfig({
    test: {
        // Scoped to this repo: the default include sweeps in `.impeccable/`,
        // a vendored submodule with 93 tests of its own.
        include: ['tests/**/*.test.ts'],

        /*
         * Forces `Accept-Language: en-GB` on every request the suite makes,
         * so the app renders the English catalogue rather than the `de-DE`
         * default `FALLBACK_LOCALE` now names (issue #19). Without it, ~200
         * English copy assertions across 49 files would compare against
         * German and report "page did not render its content", which is
         * indistinguishable from a blanked page or a permissions bug. The file
         * explains why it patches `fetch` once instead of touching 51 call
         * sites.
         */
        setupFiles: ['tests/helpers/setup.ts'],

        // The integration suites share one set of fixture ids and each
        // `beforeAll` re-seeds them, so in parallel they race on unique ids.
        fileParallelism: false,

        /*
         * RAISED FROM VITEST'S DEFAULTS (5s test, 10s hook), which were never
         * chosen for this suite.
         *
         * Every integration file's `beforeAll` calls `seed()`, which calls
         * `teardown()`, which DELETEs the fixture tenants: a cascade across
         * some forty tables with row-level security and append-only triggers on
         * several of them. That legitimately takes seconds, and it runs once per
         * file with `fileParallelism` off, so the files contend for one
         * database. At 10s it intermittently lost, and an intermittently red
         * suite is worse than a slow one: it teaches everyone to re-run instead
         * of to read.
         *
         * These are ceilings for a pathological run, not budgets. A suite that
         * starts needing them is saying something about the fixture, and the
         * answer is to look rather than to raise these again.
         */
        testTimeout: 20_000,
        hookTimeout: 40_000,
    },
    resolve: {
        alias: {
            '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
            '~': fileURLToPath(new URL('./app', import.meta.url)),
        },
    },
});
