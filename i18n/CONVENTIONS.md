# i18n conventions (issue #19)

Read this before adding a message. It holds **rules**; the reasoning for the
architecture around them is in the doc comments of `shared/language.ts`,
`app/plugins/i18n.ts` and `i18n/messages.ts`, and the decision record is
DECISIONS.md § "i18n".

## The one boundary that matters

**Translate only what the app authored.** Tenant-entered open vocabulary is
never translated, in any language: Role names, Group names, Session/Offering
`kind` values, Equipment/Feature tags, custom Constraint names, Room names,
Term names.

This is the fixed-vs-open taxonomy principle (CLAUDE.md § "Fixed vs. open
taxonomy") applied to text. A tenant that names a kind "Vorlesung" has named
it that, and translating it would mean the app deciding what the tenant's own
vocabulary means, which is the same mistake as hardcoding a Role called
"Student" into logic.

The test: **did this repo write the string, or did a customer type it?**

## Where the locale comes from

Nothing in `app/` decides this, and nothing new may. `resolveLocale()`
(`shared/locale.ts`, issue #17) is the single implementation, and
`resolveLanguage()` (`shared/language.ts`) derives the message language from
its result. Two axes, deliberately:

| Axis | Value | Decides | Read via |
|---|---|---|---|
| Formatting locale | any BCP-47 tag (`de-AT`, `fr-FR`) | date and number shape | `useViewerLocale()` |
| Message language | `de` or `en` | which message tree | `useLanguage()` |

So `formatDate(iso, locale)` and `formatNumber(value, locale)` take the FULL
tag, and `t()` reads the language. Never use vue-i18n's `n()`/`d()`: they
format against the language, which has already discarded the region.

## Key naming

    <namespace>.<group>.<name>

- **`namespace`** is one of the 18 files in `i18n/locales/<lang>/`. Never
  invent one: a new namespace means a new file in both trees *and* a line in
  both barrels, and `tests/i18n-catalogue.test.ts` fails until all four exist.
- **`group`** is the component, page or entity the copy belongs to, camelCase
  (`loginForm`, `offering`, `solverControl`).
- **`name`** says what the string *is*, not what it says: `emptyHint`, not
  `noPersonsYet`. Renaming copy must not mean renaming a key.

Segments are camelCase. Depth beyond three is allowed where it earns its
place (`manage.offering.field.title.help`), but a key is never a prefix of
another key: `LeafKeys` stops at the first `string`, so `a.b` and `a.b.c`
cannot both exist.

**No arrays in the message tree.** A list of copy becomes numbered keys
(`principle1`, `principle2`) or, where the list is genuinely data, stays a TS
array of *keys* that `t()` is mapped over. Arrays would make a branch a valid
leaf and quietly break `MessageKey`.

## Values

- English is the **structural** source: a key exists in `en` first. German is
  the **default language**, which is a different role. See `i18n/messages.ts`.
- **Extraction and translation are two passes.** Extraction writes the English
  value into BOTH trees, unchanged. Translation then replaces the German
  values. Copying English rather than leaving German empty is what keeps every
  intermediate commit shippable: the key sets stay identical (a test enforces
  it) and a German reader sees English rather than a raw key.
  - **`auth` is the one exception, and it is not a precedent.** It carries real
    German because it was the mechanism proof in Phase 0, and
    `tests/i18n-rendering.test.ts` asserts German SSR output, so it needed
    real German to test against. Every other namespace copies English during
    extraction.
- Copy moves **verbatim** during extraction. Improving a sentence and moving
  it in one step means a diff nobody can review; if a string is wrong, note it
  and fix it separately.
- Join multi-line concatenations into one value before keying. There are ~96
  of them and a keyed half-sentence is unusable to a translator.
- Keep the existing punctuation and capitalisation exactly, including the
  presence or absence of a trailing period. ~200 integration assertions match
  these strings character for character.

### Interpolation

Named, never positional:

```json
{ "emptyHint": "Create a {entity} first: an offering has to belong to one." }
```

```ts
t('manage.offering.emptyHint', { entity: term.label })
```

Positional (`{0}`) is banned: German reorders clauses, so a translator must be
able to move a placeholder without knowing what position it held in English.

### Pluralisation

vue-i18n's `|` forms, in one string, always with the count passed:

```json
{ "sessionCount": "no sessions | one session | {count} sessions" }
```

```ts
t('schedule.grid.sessionCount', count)
```

Three forms (zero | one | other) where zero reads better as prose, two
otherwise. **German has no `-s` plural**, so a suffix flip is never a
translation.

**Rewrite the sentence, never patch the word.** ~108 sites currently build
plurals inline, and the bad ones interleave agreement:

```vue
<!-- WRONG, and not translatable: -->
{{ n }} issue{{ n === 1 ? '' : 's' }} {{ n === 1 ? 'is' : 'are' }} withheld
<!-- ...leave {{ n === 1 ? 'it' : 'them' }} in place -->
```

A word split across mustaches has no key. The whole sentence becomes one
plural message, including its verb and its pronouns.

## Assembled sentences: grammar or punctuation?

Several modules build a sentence by gluing fragments (`'every day'`,
`', weeks '`, `' and '`, `' · '`). Concatenated fragments are usually not
translatable: German reorders clauses and inflects endings, so a translator
handed `'every day'` and `', weeks '` separately cannot produce a correct
sentence. But not every join is grammar, and treating them alike produces
either untranslatable copy or a pile of messages with nothing in them.

**The test: does the fragment carry GRAMMAR, or is it PUNCTUATION between
finished items?**

- **Grammar → one whole message per shape**, with only values interpolated.
  `describeWindow()` (`app/utils/availabilityLabels.ts`) builds one clause
  whose grammar spans three axes, so it became eight messages, one per
  combination, named by structure (`daysBlocksWeeks`, `everyDayWholeDay`).
  `'every day'`, `'all day'`, the word `block` and the `', weeks …'` clause no
  longer exist as separate strings, which is the point: those were the pieces
  a translator could not place.

- **Punctuation → leave the join in code.** `describePreferences()` in the same
  file builds a bulleted list of items that are each already complete and
  independent: weekday names, blocks with clock times, tenant-named equipment
  (never translated), and one app-authored weight clause. Only that clause is
  copy. Keying the fourteen present/absent combinations would have produced
  fourteen messages whose entire content is `{days} · {blocks} · {weight}` —
  nothing to translate and fourteen places to maintain.

The two functions look alike and are not, so both carry a doc comment saying
which side of this test they fall on. Add one when you make the call, or the
asymmetry reads as an oversight to the next person.

**A conjunction is grammar.** `join(' and ')` becomes a pairwise fold through a
message (`"{list} and {next}"`), never a bare `' and '` fragment — that way the
conjunction is translatable at any list length. Test it at lengths 1, 2 AND 3:
a fold reads correctly at 2 and wrongly at 3.

## Copy in plain `.ts` modules: thread `t`, do not call `useT()`

A lot of this app's copy lives in modules that are not components
(`navPlaces.ts`, `manageRegistry.ts`, `shared/permissions.ts`,
`shared/constraintTypes.ts`). `useT()` is illegal in all of them, for two
independent reasons and either one is decisive: it needs Vue's injection
context, so it cannot run inside a lazily-evaluated `computed` getter, and
several of these modules are imported by unit tests that run in plain Node
with no Nuxt instance, which their own doc comments say is the point of them.

So they take a translator, typed `Translate` (`app/composables/i18n.ts`).
**Import that type; never declare your own.**

**Thread it into the function that BUILDS the structure, not onto each field.**

```ts
// YES: every field stays a plain resolved string.
export function navPlaces(t: Translate): NavEntry[]

// NO: pushes the callable shape into every component that reads the field.
label: (row, t) => t('...')
```

The tempting per-field form makes the *readers* pay: `NavEntry.label` is read
by five surfaces (header menu, sidebar, dashboard cards, command palette, nav
rail), and every one would have to learn to call a label instead of rendering
a string. Threading `t` into the builder confines the change to the few call
sites that build the structure.

**Required, never optional with a fallback.** An optional `t` defaulting to
identity or to English lets a call site that forgets it compile clean and
render a raw key, or the wrong language, to a user. Required makes it a
typecheck error instead.

In a unit test that measures structure rather than copy, stub it as
`(key) => key`. No cast is needed and no catalogue has to be loaded.

## Never case-transform user-facing text

`.toLowerCase()` and `.toUpperCase()` on copy do not survive translation.
**German capitalises every noun**, so `entity.plural.toLowerCase()` renders
"räume" instead of "Räume". Turkish has a dotless i, so a lowercase round trip
can change a word's letters.

The fix is always the same shape: one message with a named placeholder and no
transform.

```ts
// NO
`Search ${ entity.plural.toLowerCase() }…`
// YES
t('manageUi.list.searchPlaceholder', { entity: entity.plural })   // "Search {entity}…"
```

Where the interpolated value is an ENUM rather than data, do not interpolate at
all: write **one message per case**. `app/pages/my/exams.vue` carries the
precedent and states it ("ONE MESSAGE PER KIND, never `kind.toLowerCase()`
interpolated"), because lowercasing an enum only ever produces English.

Two things that look like this rule and are not: lowercasing into a CSS class
name, and lowercasing to build `keywords` (never rendered, and
`searchKeywords`/`fuzzyMatch` already fold case).

### The audit, for the slices that still have to act on it

`manageRegistry.ts` has none; every instance is in a consumer file:

| File | Site |
|---|---|
| `ManageList.vue` | `Search {entity}…`, plus three distinct states: load failure, no search match, empty |
| `ManageRelationPicker.vue` | `Search {label}`, `Search {label}…`, `Add {label}…` |
| `ManageRelationsPanel.vue` | `Save this {entity} first…`, and a `.map(d => d.label.toLowerCase()).join(', ')` over a list of translated labels |
| `ManageCalendarPeriodForm.vue` | `A {kind} claims a week…` — an ENUM, so one message per kind |
| `pages/manage/[entity]/{new,index,[id]}.vue` | `New {entity}`, `Create a new {entity} in this institution.`, `This {entity} could not be loaded.` |

## Route middleware: `$t`, not `useT()`

Four middleware files author a sentence a person reads (`manage.ts`, `my.ts`,
`review.ts`, `schedule.ts` all throw `createError({ message })`). There
is no component setup there, so `useT()`/`useI18n()` throws.

`app/plugins/i18n.ts` provides `t` for exactly this:

```ts
const { $t } = useNuxtApp();
throw createError({ statusCode: 403, message: $t('errors.manage.unknownSection') });
```

It is typed `Translate`, so `MessageKey` checking still applies.

**The language is settled by then, and the reason is ordering.** Those four are
NAMED middleware, so Nuxt runs them after every global one, and
`i18n.global.ts` has already applied the language before any of them executes.

**Not a general escape hatch.** A component that reaches for `$t` out of habit
still typechecks and still works, which is precisely why the rule has to be
written down rather than enforced: `useT()` is the entry point wherever a setup
context exists.

A corollary that bit twice: **a module-level `const` holding copy cannot
survive** (`SCHEDULE_DENIAL`, `DIFF_TAG`, `STATUS_LABEL`, `MODES`, `EFFECT`).
Module scope is evaluated before any language is known, so a resolved string
there freezes whichever language happened to load first. Hold `MessageKey`s in
the constant and resolve at the point of use, or make it a `computed`.

## Search keywords

Command-palette synonyms are translated **and keep their English terms as
aliases**, concatenated rather than replaced. An admin who learned the product
in English must still find the page after switching language, and a German
admin should not have to guess the English word.

This covers `manageRegistry`'s `keywords` (96 terms) **and `navPlaces.ts`'s
(~30 arrays)**. The latter were nearly left out because the field is marked
"never shown", which is true and beside the point: they are what Ctrl+K
matches against, so leaving them English makes the palette useless in the
default language. Never shown is not never read.

### How a keyword list is stored

**One key per entry, holding a COMMA-SEPARATED string.** Not one key per term:
the number of useful synonyms differs per language and per entry, so a
translator adding a sixth German word for "Raum" must not need a schema
change, and numbered `keyword1…keyword8` keys are the `principle1/principle2`
escape hatch used for something it does not fit. A JSON array is forbidden
outright — it would break `MessageKey`.

**A keyword may therefore never contain a comma.** Phrases are fine
("right to access", "preferred days"); clauses are not.

### Merge them with `searchKeywords()`, never by hand

`app/utils/i18nKeywords.ts` is the single implementation:

```ts
keywords: searchKeywords(t, 'nav.place.home.keywords', ['home', 'start', 'dashboard']),
```

It splits on commas, trims, drops empties, appends the English aliases and
dedupes case-insensitively. **Do not write your own** — two copies of
"translated terms plus English aliases, deduped" is the
one-implementation-per-operation rule in CLAUDE.md failing exactly as
described: they drift on the delimiter or the dedupe and nothing reports it,
because the only symptom is a search that stops finding one section.

**The English aliases stay in CODE**, duplicated into `en/*.json`. Decided
once, here, so it is not re-decided per namespace. The tempting alternative,
reading them back out of the English tree with a locale override, is legal
vue-i18n and returns the RAW KEY when that tree is not loaded — a palette that
silently stops matching, unfixable by inspection. Dedupe makes the duplication
free.

**Keyword order and casing are cosmetic.** `fuzzyScoreEntry` takes the max over
keywords and `fuzzyMatch` lowercases both sides, so neither affects ranking.
Do not spend time on either.

## Namespace ownership

One namespace has exactly one owner during extraction, so that eight agents
can write concurrently without touching a shared file. The barrels
(`i18n/locales/*/index.ts`) were written up front for this reason and are
**not** edited during extraction.

| Namespace | Covers — every file, explicitly |
|---|---|
| `common` | **Owned by nobody.** Pre-populated with `common.action.*` (15 verbs), `common.field.*` (11 atomic labels) and `common.value.*` (none/never/all). Agents read it, never write it. |
| `nav` | `utils/navPlaces.ts`, `utils/navGroups.ts`, `composables/navigation.ts`, `composables/commandPalette.ts`, `components/common/CommonAppShell.vue`, `components/views/{ViewNavDrawer,ViewTenantSwitcher,ViewMenu}.vue` |
| `auth` | `pages/login.vue`, `pages/change-password.vue`, `components/views/ViewLogin.vue`, `LOGIN_ERROR_KEY` in `composables/session.ts` |
| `landing` | `utils/landingContent.ts`, `utils/landingContact.ts`, `components/landing/`, `pages/index.vue` |
| `pricing` | `utils/pricingContent.ts`, `utils/pricingModel.ts`, `pages/pricing.vue` |
| `manage` | `utils/manageRegistry.ts` **only** |
| `manageUi` | `components/manage/`, `composables/entityForm.ts`, `composables/entityRelations.ts` |
| `managePages` | `pages/manage/` and its subdirectories, **except `data-export/`** (that is `exports`, which owns data-export copy wherever it lives) |
| `schedule` | `components/schedule/`, `pages/schedule/`, `composables/schedule.ts`, `scheduleData.ts`, `scheduleEditing.ts`, `solverRun.ts`, `generationReview.ts`, `composables/gridGeometry.ts`, `utils/schedulePermissions.ts` |
| `my` | `pages/my/` (including `api-tokens/` and `data-export/`), `components/my/`, `utils/apiTokenPresets.ts` |
| `availability` | `components/availability/`, `utils/availabilityLabels.ts` |
| `staff` | `pages/staff/` |
| `dashboard` | `pages/dashboard.vue`, `components/dashboard/`, `utils/institutionCounts.ts`, `composables/dashboardCounts.ts` |
| `screen` | `pages/screen.vue` |
| `errors` | `composables/httpError.ts`, `middleware/manage.ts`, `middleware/my.ts`, `middleware/review.ts`, `middleware/schedule.ts`, `utils/schedulePermissions.ts`'s `SCHEDULE_DENIAL` |
| `permissions` | `shared/permissions.ts` descriptions — **Phase 3, not extraction** |
| `constraints` | `shared/constraintTypes.ts`, `shared/sessionKindType.ts`, `shared/academicCalendar.ts`'s `WEEK_KIND_NAME` — **Phase 3, not extraction** |
| `exports` | `pages/manage/data-export/`, `components/my/DataExportPanel.vue`. **Owns `DataExportPanel` even though it sits in `components/my/`** — the more specific entry wins, so the `my` owner leaves it alone rather than splitting one screen's copy across two namespaces. |

**Out of scope, owned by nobody, do not extract:**

- `shared/availability.ts`'s three validation messages. They travel the
  server's error-`message` path, which issue #19 deferred by decision, so
  translating the client half alone would split one message across two
  mechanisms.
- `formatDate()`'s `'date unknown'` fallback (`app/utils/formatDate.ts`). It is
  app-authored and user-facing, so it genuinely belongs in the catalogue, but
  the function is a pure helper taking an explicit locale and is called from
  eight sites; threading a required `t` through all of them to translate one
  string that renders only for an unparseable date is churn out of proportion
  to the gain. Tracked as a follow-up, not silently forgotten.

**If a file is not named above, it has no owner.** Report it rather than
claiming it: the pilot found three unowned nav entries this way, and guessing
is how two agents end up editing one file.

`common` is the one shared namespace. Adding to it is a deliberate act: a
string used in one place belongs in that place's namespace, and a `common`
key that turns out to be area-specific is worse than a duplicate, because
changing it changes screens the author never looked at.

## What is out of scope

- `defineRouteMeta` OpenAPI `summary`/`description` (398 strings): API
  documentation, not UI.
- `scripts/` CLI output: operator-facing.
- Server error messages (206 strings): deferred by decision, see DECISIONS.md.
  They remain English diagnostic detail; the ~15 UI sites that display one
  show an app-authored translated message as the primary text and the server's
  string as detail.
- Downloaded spreadsheet headers (`personExport.ts`, `tenantExport.ts`) and
  the ICS `'Untitled event'` fallback: deferred, own card.

## Known follow-ups

Recorded here rather than in a comment on the thing they concern, because a
comment on one file is invisible to the person who next touches another. None
is a blocker; all are deliberate deferrals.

1. **Consolidate duplicate atoms into `common`, in ONE pass once all
   extraction has landed.** Extraction found the same short string authored in
   two namespaces: "Sign in" (`auth.login.submit`, `landing.action.signIn`),
   "Standard", "Included", "Get in touch", "optional". Doing this
   opportunistically per namespace is worse than doing it late: a `common` key
   chosen from two examples is exactly the "turns out area-specific" mistake
   this file warns about, and German may legitimately want different words for
   a landing CTA and a form button. Consolidate with every duplicate visible
   at once, or not at all.

2. **`formatDate()`'s `'date unknown'`** stays English. See the out-of-scope
   note above for why threading `t` through eight call sites is out of
   proportion to one string behind an error condition.

3. **Percent and unit spacing is the translator's job, not the code's.** Where
   a message reads `"{n}%"`, German typography wants `"{n} %"`; that is a
   message edit in the translation pass, never a formatting helper. (The
   instance this named, `landing.calculator.percentValue`, is gone: it existed
   only for the negotiated-discount slider, which was removed from the
   customer-facing calculator.)

4. **Everyone's collapsed sidebar topics reset once.** `useNavGroupCollapse`
   used to key the `nav_closed` cookie by the group's English heading and now
   keys it by a stable id, so existing cookies match nothing. No migration
   code: an unmatched id is simply never found. It will read as a small
   regression the first time.

5. **Near-duplicate sentences in `pricing`** differ only by a trailing period
   (`flat.supportStandard.basis` against `supportTier.standard.detail`, and the
   same for priority and partner). Kept verbatim rather than merged, because
   extraction moves copy unchanged. A translator will rightly file a bug.

6. **`shared/availability.ts`, server error messages, and downloaded
   spreadsheet headers** are deferred by decision, not oversight. See the
   out-of-scope list.

7. **Two date-formatting sites bypass the viewer's locale.**
   `app/pages/staff/index.vue` calls `new Date(...).toLocaleDateString()` twice
   with no locale, and `ScheduleReviewSummary`/`ScheduleSolverControl` call
   `Number#toLocaleString()` with none. That is the axis-mixing this file warns
   about, and it is the same hazard `formatDate.ts` and `ScheduleMiniMonth.vue`
   were already fixed for: `undefined` resolves the SERVER's locale during SSR
   and the BROWSER's on hydration. Pre-existing and outside extraction, but
   those values now sit inside translated sentences, so they read as a bug in
   the translation rather than in the formatting. Route them through
   `formatDate(iso, locale)` / `formatNumber(value, locale)`.

8. **`weekdayName(day)` is called with no locale at roughly eight schedule
   sites** (`ScheduleAgenda`, `ScheduleEventForm`, `ScheduleBlockedDayButton`,
   both review grids, chip accessible names, both grids' cell labels). The
   localised path already exists (`intlWeekday`); the call sites simply do not
   use it, so a German reader sees "Monday" inside otherwise-German copy. This
   is locale threading rather than extraction, and `tests/slot-date.test.ts`
   pins the current behaviour, so it needs its own change rather than a
   drive-by fix.

9. **Two copy bugs extraction preserved rather than fixed**, per the
   move-it-verbatim rule. `staff/index.vue`'s federation error renders a
   doubled apostrophe (`Could not update 'acme''s federation.`), and three
   sentences use a plural verb with no singular form, so they render "1 name
   sessions", "1 placements", and "1 session left exactly as they are" (whose
   singular already disagreed with "they"). Each now has a plural message,
   which is somewhere a translator can fix them; the English still needs an
   author's decision.

## Phase 3 has one hard blocker, and it is not the copy

**Translating `shared/constraintTypes.ts`'s labels silently breaks
`ManageConstraintBuilder`'s rename detection.** Recorded here rather than
discovered later, because the failure is invisible.

That component decides whether a tenant has renamed a default constraint:

```ts
wasAutoFilled = !draft.name || CONSTRAINT_TYPES.some((c) => c.label === draft.name)
```

`defaultConstraintRow()` writes `type.label` into the `constraint.name` COLUMN
at provisioning, so every existing row holds the ENGLISH label. The moment
`c.label` becomes a `t()` call, a German session compares German labels against
English stored names, nothing matches, and the check degrades to "only fills a
blank name" — which is exactly the bad-data case its own comment says it exists
to prevent. Nothing throws, nothing logs, and the UI keeps looking correct.

The resolution needs no migration, and the reason is that every one of the
three affected tables already carries a stable identity beside its name:
`role.key`, `access_role.key`, `constraint.type`, plus `is_system` /
`is_default`. So:

- **Display** the translated catalogue label while a row is still
  system/default AND its stored name matches the English original.
- **Display the stored name** otherwise, because a tenant who renamed it has
  spoken and their vocabulary wins (CLAUDE.md § "Fixed vs. open taxonomy").
- **Compare against the ENGLISH label**, never the translated one. The English
  tree is still loaded and still the structural source, so "is this row
  untouched?" stays answerable in any language.

Making the column nullable was considered and rejected: it is a migration where
none is needed, and it would discard the one fact the comparison depends on.

## Server error text lives in `message`, not `statusMessage`

Every `createError` in this repo passes **`message`**. `statusMessage` is
emitted into the HTTP status LINE (`HTTP/1.1 401 Invalid credentials.`), and h3
sanitises it by default in a coming version, so a sentence put there is a
sentence that will silently disappear.

Verified against a live 401 after the move: the body reads
`{ statusCode: 401, statusMessage: 'Server Error', message: 'Authentication
required.' }`, and the status line is now the generic `401 Server Error`. Both
halves of that matter — the sentence survives in the body, and arbitrary text
no longer reaches a header.

**Read it with `serverErrorMessage()`** (`app/composables/httpError.ts`), never
with an inline cast. There were about sixty of those, and each was a separate
chance to read the wrong field. Two traps it exists to close:

- `error.message` on an `ofetch` rejection is ofetch's own construction
  (`[GET] "/api/persons": 404 Not Found`) — a thing to log, never a thing to
  show a person. The server's sentence is only ever in `error.data`.
- Falling back to `statusMessage` looks defensive and is harmful now: h3 fills
  the unset field with a generic phrase, so the fallback surfaces the literal
  words "Server Error" to a reader instead of the caller's own translated
  message. The helper returns `null` and the caller owns the fallback.
