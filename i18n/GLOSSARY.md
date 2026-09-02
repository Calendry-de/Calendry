# German glossary (issue #19)

**Status: in use.** These terms are what the German catalogue actually says,
so a change here is a change to shipped copy — but a cheap one: each term is a
find-and-replace confined to `i18n/locales/de/`, with no code to touch.

Read it before adding German anywhere. Eight parallel translators bound to
different words for one entity produce a catalogue that has to be redone, which
is why the vocabulary is settled here rather than per namespace.

Every term here is **app-authored**, so all of it is translatable. Tenant-entered
vocabulary is not, ever: see `i18n/CONVENTIONS.md` § "The one boundary that
matters".

## Style rules that apply to every string

| Rule | Choice | Why |
|---|---|---|
| Address | **"Sie"**, never "du" | The users are administrators, department heads and lecturers at institutions, addressed in a professional tool. "du" reads as consumer software. |
| Gender | **Neutral by construction**, never Binnen-I or asterisk | "die Lehrkraft", "die Person", "Nutzende", direct address ("Sie können …"), or the passive. No "Benutzer/in", no "Nutzer\*innen": the first is unreadable, the second is politically marked and this app does not need to take that position to be correct. Where a neutral noun does not exist, rephrase around it. |
| Compounds | Spell out; hyphenate only for readability | "Lehrveranstaltung", not "LV", in prose. Abbreviate only where a column is genuinely too narrow, and then consistently. |
| Quotation marks | German „…" | Matches the locale the page declares. |
| Ellipsis, dashes | „…" and „–" | As in the existing English copy. |

## The two terms you flagged

Both resolve to one word, and both work for the same reason: **the entity
label is app-authored, but the individual thing's NAME is the tenant's own.**
A school never reads the word "Semester" where it would rather read
"Schuljahr" — it reads its own Term's name, "Schuljahr 2026/27". The label
appears in field labels and navigation, where a neutral word is what you want.

| Term | German | Why this one | Rejected |
|---|---|---|---|
| **Term** | **Semester** | A real German word in active use in both sectors, short enough for a column header, and it collides with nothing else in this app. TAXONOMY.md §2 already writes "Terms/Semesters". A school names its own Term "Schuljahr 2026/27" and reads that, not this label. | "Zeitraum" collides head-on with calendar periods (Holidays, Breaks, Exam periods are literally Zeiträume). "Lernabschnitt" is correct German school-law vocabulary and unknown at a university. "Schuljahr"/"Halbjahr" over-specify a duration the entity does not fix. |
| **Group** | **Gruppe** | A `Klasse` *is* a nestable Gruppe, which is exactly what the entity models (Cohort → Class → Seminar Group). The tenant names theirs "10a". | "Klasse" is school-only and collides with the CSS/OOP sense in developer-facing strings. "Kohorte" is university-only and unusual. |

## Fixed entities

| Entity | German | Why this one | Rejected |
|---|---|---|---|
| Federation | **Verbund** | The natural German for a consortium of institutions (cf. Hochschulverbund, Bibliotheksverbund). | "Föderation" is a calque that reads as politics or networking. "Verband" implies a member association with governance. |
| Tenant | **Institution** | What the existing English UI already calls it ("Your account belongs to more than one institution"). A school secretary understands it immediately. | "Mandant" is the correct multi-tenancy term in German enterprise software and is pure jargon to this audience. |
| Person | **Person** | Already German, already the entity's name, gender-neutral. | — |
| Group | **Gruppe** | See above. | |
| Room | **Raum** | | |
| Equipment | **Ausstattung** | Covers fixed room features (Beamer, Whiteboard) as well as movable kit, which is what the entity actually holds. | "Ausrüstung" suggests gear you carry. "Geräte" excludes non-device features. |
| **Offering** | **Lehrveranstaltung** | The standard German academic term for exactly this thing: the recurring definition, distinct from its individual dates. "Lehr-" keeps it right for a school too. | "Angebot" is the literal translation and means nothing here. "Kurs" implies enrolment. "Fach" is the subject, closer to `kind` or the title. "Veranstaltung" alone collides with Session/Event. |
| **Session** | **Termin** | Precisely "a scheduled point in time", which is what a placed Session is. Pairs naturally with the entity above: eine Lehrveranstaltung hat viele Termine — that *is* the two-level model, in ordinary German. | "Sitzung" means a meeting and is the wrong register. "Stunde" implies a 45-minute school lesson and a fixed duration the entity does not have. "Einheit" is vague. |
| Session (Offering-less, "Event") | **Einzeltermin** | Distinguishes it from an Offering-linked Termin in one word, and says the true thing: it stands alone and therefore needs its own name. | "Ereignis"/"Event" lose the "belongs to nothing" meaning that is the entire distinction. |
| TimeGrid | **Zeitraster** | Standard German for exactly this. | — |
| Block | **Block** | Already German and already used in German timetabling. | "Stunde" implies a duration. |
| Timeslot | **Zeitfenster** | | "Zeitslot" is a half-anglicism. |
| **Constraint** | **Regel** | The app's own framing is a "rule builder" with predefined types, not a constraint solver's mathematics. "Regel" is what an administrator thinks they are configuring. | "Nebenbedingung" is the correct OR term and unreadable. "Einschränkung"/"Beschränkung" sound punitive for what is often a preference. |
| — hard / soft | **harte / weiche Regel** | Established German usage. | |
| Membership | **Mitgliedschaft** | | |
| Assignment | **Zuordnung** | | "Zuweisung" implies an act rather than the relation. |

## Access control (the pair that must never merge)

CLAUDE.md: *"`Role` and `AccessRole` share a word and are different things.
Never merge them."* German must keep them further apart than English does, not
closer.

| Term | German | Note |
|---|---|---|
| Role (scheduling vocabulary) | **Rolle** | What a Person *is*. |
| AccessRole (authorization) | **Berechtigungsrolle** | What a Person *may do*. Long on purpose: the two must not be confusable at a glance. |
| Permission | **Berechtigung** | |
| Lecturer | **Lehrkraft** (pl. **Lehrkräfte**) | Gender-neutral by construction, and the only candidate that works in the singular at both a school and a university. "Lehrende" is awkward in the singular; "Dozent" and "Lehrer" are male-default and sector-bound. |

## Solver and planning

| Term | German | Why |
|---|---|---|
| Solver | **Solver** | Kept. It is a named technical component, and German-language OR/timetabling usage says "Solver". |
| Solver run | **Planungslauf** | Reads as German; "Solver-Lauf" is a hybrid. |
| Generation | **Planvorschlag** | It is a proposed schedule awaiting a decision, which is what the UI already calls "Proposals". "Generierung" describes the act, not the artefact. |
| Violation | **Regelverstoß** | Pairs with "Regel". |
| Locked (Session) | **fixiert** | "Gesperrt" means blocked/barred; a locked Session is pinned in place, not forbidden. |
| Spare bank | **Reservepool** | ⚠ Lowest-confidence entry in this table — please check. It holds cancelled Sessions parked for re-placement (issue #22). |

## Self-service and other areas

| Term | German | Note |
|---|---|---|
| Availability | **Verfügbarkeit** | |
| Unavailability / blackout | **Sperrzeit** | |
| Preference | **Wunsch** / **Wünsche** | "Lehrerwünsche" is the established term in German timetabling and is warmer than "Präferenz", which stays for technical labels. |
| Exam | **Prüfung** | |
| Exam request | **Prüfungsantrag** | |
| Screen (lobby display) | **Anzeigetafel** | What a German school calls the board in the entrance hall. "Display"/"Infoscreen" are anglicisms, though common. |
| Substitution plan | **Vertretungsplan** | The established term; already used in issue #31. |
| Curriculum plan | **Lehrplan** | |
| Offering template | **Lehrveranstaltungsvorlage**, short **Vorlage** | |
| Calendar link | **Kalender-Abo** | An ICS subscription. "Kalenderlink" loses that it keeps updating. |
| Calendry staff | **Betreiber** | Distinguishes Calendry's own operators from an institution's staff, which German would otherwise blur. |
| Tenant admin | **Institutionsadministration** | |
| Utilization | **Auslastung** | Already used in issue #71. |

## A consequence worth deciding with the glossary

Three tables store **English app-authored text as data**, written at
provisioning: `role.name` ('Lecturer'), `access_role.name` ('Tenant
Administrator') and `constraint.name` (from the catalogue's `type.label`).
Translating the catalogue does not retro-translate those rows, and
`ManageConstraintBuilder.vue:571` compares a typed name against the English
label to detect "renamed from default".

**The migration-free answer, which I recommend:** every one of those rows
carries a stable identity beside its name — `role.key`, `access_role.key`,
`constraint.type` plus `is_system` / `is_default`. So the UI displays the
**translated catalogue label** when a row is still system/default *and* its
stored name matches the English original, and the **stored name** otherwise,
because a tenant who renamed it has spoken and their vocabulary wins. That is
the fixed-vs-open boundary applied exactly as CLAUDE.md draws it, needs no
migration, and no existing row changes.

This replaces the "make the column nullable" option from the plan, which
would have been a migration. Confirm and it becomes Phase 3's approach.

## Terms the translation pass had to settle, and did

These were missing from the table above. Each was chosen by a translator with
the whole namespace in front of them, and **two or more agents converged on the
same word independently** for the first two — which is the strongest evidence
available that they are the natural German. Verified mechanically across the
German trees: "Stundenplan" appears 54 times in six namespaces with **no**
competing variant ("Zeitplan", "Belegungsplan": zero), and "Terminart" 14 times
with no "Sitzungsart".

**Phase 3 (`shared/permissions.ts`, `shared/constraintTypes.ts`) must match
these**, or a sentence will point at a section by a name that is not on screen.

| Term | German | Note |
|---|---|---|
| Schedule / the timetable | **Stundenplan** | The standard German timetabling word in both sectors. Note the apparent tension with rejecting "Stunde" for Block — harmless inside a closed compound. |
| Session kind | **Terminart** | Derived from Termin. `shared/sessionKindType.ts` is Phase 3's and **must use this word**. |
| Calendar period | **Kalenderzeitraum** | The very reason "Zeitraum" was rejected for Term is the argument for it here. |
| Break (a week) | **Unterrichtsfreie Zeit** | NOT "Pause", which is already spent on a TimeGrid break between blocks. One word for both would collapse two unrelated things. |
| Solver move / move budget | **Schritt** / **Schritt-Budget** | "Zug-Budget" reads as a train; "Move-Budget" is a hybrid. |
| Scheduling roles | **Planungsrollen** | Chosen for visible parallelism with **Berechtigungsrollen**, so the never-merge pair stays two words apart at a glance. |
| Severity (hard/soft) | **Härte** | Not "Schweregrad"; the values are harte/weiche Regel. |
| Auditor | **Gasthörende** | Gender-neutral; "Auditor"/"Gasthörer" are male-default. |
| Locale (the field label) | **Gebietsschema** | The established German rendering. |
| Code (a short human id) | **Kürzel** | Not "Code", which reads as machine code. |
| Students | **Lernende** (sg. *lernende Person*) | Settled. The only candidate that is both gender-neutral AND valid at a school and a university: "Studierende" is university-only, "Schüler" is school-only and male-default. **It cannot be made mode-dependent** — see below. |
| Cohort | **Jahrgang** (year-group) / **Klasse** (a taught class) | Two words on purpose — one German word cannot cover both senses the English uses. |
| Staff (an institution's own) | **die Verwaltung** | NOT "Betreiber", which is reserved for Calendry's own operators. |
| Keyboard modifier | **Strg**, never "Ctrl" | German keyboards label the key *Strg*. `nav.shell.search` and `landing.built.manage.note` must agree. |
| Auth session | **Ihre Anmeldung** | Deliberately NOT "Sitzung": that word is rejected for Session/Termin, so reusing it would collide in the namespace where Termin appears most. |

**Account is `Zugang` / `Zugänge`, everywhere.** Decided by the product owner
after the translation pass proposed a two-word split (Zugang in management,
Konto in the auth pages, mirroring English's own Login/account divide). One
word won: `Zugang` says precisely what an `Account` is in this model — a
credential, separate from the `Person` it belongs to — where `Konto` carries a
banking sense and reads as the generic web-app "my account".

So: „Mein Zugang", „Anderen Zugang verwenden", „Zu dieser Adresse gibt es
bereits einen Zugang." **`Konto` survives in exactly two places, both correct:**
`landing.contact.asideBody`, where it means the reader's own EMAIL account, and
`manage.account.keywords`, where both words are search synonyms so either finds
the page.

⚠ **`Zugang` is masculine**, where `Login` was neuter. Anything that touches
these strings by find-and-replace has to fix the articles and endings with it —
„das vorhandene Login" becomes „den vorhandenen Zugang", not „das vorhandene
Zugang", and „dieses Logins" becomes „dieses Zugangs". A bulk replace produced
exactly those two errors and they were caught by reading, not by any test.

**Auth session is `Anmeldung`, with one licensed exception.** „Sitzung" stays
rejected as a general rendering, so it cannot collide with Session/Termin. But
`manage.account.field.mustChangePassword.help` needs BOTH words in one sentence
— signing in succeeds yet produces no session until the password changes — and
there „die Anmeldung gelingt, erzeugt aber erst dann eine Sitzung" is the only
way to say it. The rule is about the default rendering, not a ban on the word.

**One forward dependency to honour.** `manage.room.field.ranking.help` quotes a
constraint's name — "Steer room choice by rank" — rendered
„Raumwahl nach Rang steuern". That label itself lives in
`shared/constraintTypes.ts` and is translated in Phase 3. **Phase 3 must use
that exact German**, or this sentence names a rule that does not exist.

## Why "Lernende" cannot follow the tenant's mode selector

The obvious improvement is to let `TenantMode` (`UNIVERSITY` / `SCHOOL`, the
selector in display settings) pick the word: *Studierende* for a university,
*Schülerinnen und Schüler* for a school. The mechanism exists and is already
used for exactly this kind of bias (`offeringFieldsToDeemphasize`,
`isConstraintTypeSuggested`).

**It does not reach the strings that need it.** Of the 14 places the word
appears, 10 are in `pricing` and 4 in `landing` — the PUBLIC pages. `/` and
`/pricing` are `ANONYMOUS_ROUTES`: they read no session, call no API and belong
to no tenant, which CLAUDE.md states as a rule rather than an accident. There
is no mode to consult, and a published rate card sells to both sectors anyway,
so one neutral word is the correct answer there regardless.

Only **one** in-app string mentions students at all, and that is not a
coincidence either: inside a tenant, students are a **Role**, which is
tenant-authored open vocabulary. An institution that calls them
"Studierende" types that word themselves and the app renders it verbatim. The
fixed-vs-open boundary already solved this problem everywhere it could.

So mode-dependent vocabulary remains a reasonable future feature for in-app
copy, and would have almost nothing to act on. Recorded so the idea is not
re-proposed and re-investigated.
