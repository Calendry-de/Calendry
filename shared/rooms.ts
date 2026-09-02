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
 * `TooManyRoomsRequired`: it does not truncate. So exceeding this is not a
 * degraded result, it is no result: every run fails for the whole tenant until
 * somebody finds the Offering.
 *
 * Written here once so the database CHECK, the write schema and the form agree
 * by construction. If the solver ever raises its array, this is the single
 * place the app learns it, and the migration's CHECK is the one thing that
 * does NOT read it, because SQL cannot; `tests/offering-required-rooms.test.ts`
 * asserts the two have not drifted.
 */
export const MAX_ROOMS_PER_SESSION = 4;

/**
 * What a Room with `capacity = 0` is sent as.
 *
 * ZERO MEANS UNLIMITED, not "seats nobody". An online room has no seating to
 * run out of, and a physical room with no capacity recorded is one nobody has
 * measured; neither is a room that fits nothing. The column defaults to 0, so
 * before this every Room created without a capacity was silently ineligible for
 * every Offering that asked for any, which is the worst possible reading of an
 * unset field.
 *
 * A SENTINEL, BECAUSE THE WIRE HAS NO WAY TO SAY "UNLIMITED". `Room.capacity`
 * is a `uint32` the solver compares with `room.capacity >= offering
 * .min_capacity`, and 0 fails that against any real demand. Translating at the
 * boundary is the same shape as `blackedOutWeeks()` storing POSITIVE and
 * sending NEGATIVE: the app owns what its own absent value means.
 *
 * SIZED AGAINST OVERFLOW, not for looks. A multi-room Offering has its Rooms'
 * capacities SUMMED, up to `MAX_ROOMS_PER_SESSION` of them, so the value has to
 * survive being added to itself four times inside a `u32`. A million seats
 * exceeds any institution and four million is nowhere near `u32::MAX`;
 * `u32::MAX` itself would wrap on the second room.
 *
 * TEMPORARY, and tracked: the honest fix is for the solver to read 0 as
 * unbounded, at which point this constant and its mapping go away.
 */
export const UNBOUNDED_ROOM_CAPACITY = 1_000_000;
