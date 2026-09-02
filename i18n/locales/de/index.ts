/**
 * Static barrel for one language's message tree.
 *
 * STATIC IMPORTS, NOT `import.meta.glob`, and that is deliberate: the glob is
 * a Vite feature, so it resolves in the client bundle, the SSR bundle and
 * Vitest but NOT in the Nitro server build, which rollup produces. Issue #19's
 * Phase 3 hands `server/utils/i18n.ts` this same message data for the shared
 * catalogues (`shared/permissions.ts`, `shared/constraintTypes.ts`), and a
 * loader that works in three of four build contexts would fail in exactly the
 * one nobody exercises locally.
 *
 * Hand-written rather than generated, so there is no build step to forget, and
 * `tests/i18n-catalogue.test.ts` reads the locale DIRECTORY and asserts every
 * `.json` in it appears here. A namespace file added without a line below is
 * therefore a failing test rather than a silently absent half of the UI: the
 * same read-the-directory technique `tests/helpers/migrations.ts` uses, for
 * the same reason, that a guard which can only "correctly find nothing" is
 * not a guard.
 *
 * ONE FILE PER NAMESPACE, MERGED HERE, because issue #19's extraction ran as
 * eight parallel agents over one repo: disjoint namespace ownership is what
 * let them write concurrently without a merge conflict, and this barrel is the
 * only shared file, written once up front so none of them had to touch it.
 * At runtime it is still a single chunk per language (see `i18n/messages.ts`),
 * so the authoring split costs no extra request.
 */
import common from './common.json';
import nav from './nav.json';
import auth from './auth.json';
import landing from './landing.json';
import pricing from './pricing.json';
import manage from './manage.json';
import manageUi from './manageUi.json';
import managePages from './managePages.json';
import schedule from './schedule.json';
import my from './my.json';
import availability from './availability.json';
import staff from './staff.json';
import permissions from './permissions.json';
import constraints from './constraints.json';
import errors from './errors.json';
import dashboard from './dashboard.json';
import screen from './screen.json';
import exports from './exports.json';

export default {
    common,
    nav,
    auth,
    landing,
    pricing,
    manage,
    manageUi,
    managePages,
    schedule,
    my,
    availability,
    staff,
    permissions,
    constraints,
    errors,
    dashboard,
    screen,
    exports,
};
