/**
 * How many Rooms one Session may occupy simultaneously.
 *
 * A STRUCTURAL LIMIT OF THE SOLVER, not a policy this app chose:
 * `MAX_ADDITIONAL_ROOMS = 3` in `crates/core/src/solution.rs` fixes a
 * Placement's Room array at 1 primary + 3 additional, which is what keeps
 * `Placement` `Copy` and allocation-free through a hot path walked millions of
 * times per run.
 *
 * `convert.rs` REFUSES an Offering asking for more, with
 * `TooManyRoomsRequired` — it does not truncate. So exceeding this is not a
 * degraded result, it is no result: every run fails for the whole tenant until
 * somebody finds the Offering.
 *
 * Written here once so the database CHECK, the write schema and the form agree
 * by construction. If the solver ever raises its array, this is the single
 * place the app learns it — and the migration's CHECK is the one thing that
 * does NOT read it, because SQL cannot; `tests/offering-required-rooms.test.ts`
 * asserts the two have not drifted.
 */
export const MAX_ROOMS_PER_SESSION = 4;
