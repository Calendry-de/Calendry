/**
 * The default solver budget: one declaration, read by both sides.
 *
 * WHY `shared/` AND NOT A LITERAL IN THE ROUTE
 * --------------------------------------------
 * Two consumers must agree and previously only claimed to:
 *
 *   server/api/solver/runs/index.post.ts   the default when a caller sends none
 *   ScheduleSolverControl.vue              what the advanced disclosure shows
 *
 * The toolbar's comment said it was "seeded from the route's own defaults", but
 * nothing enforced that — they were two `50_000` literals that happened to
 * match. Raising one without the other would have been invisible in exactly the
 * worst way: the route's default would improve, every run started from the
 * toolbar would keep sending the old value explicitly, and the disclosure would
 * describe a budget no plain click ever used.
 *
 * WHY THE MOVE BUDGET IS 30,000,000
 * ---------------------------------
 * Measured on the demo tenant's real term (260 placements), seed 42, one run at
 * a time, restarting the solver between runs so each is genuinely fresh:
 *
 *   maxMoves      termination   moves        elapsed   objective
 *   5,000,000     move_budget    5,002,752      886 ms      441.9
 *   10,000,000    move_budget   10,000,384    1,773 ms      431.6
 *   20,000,000    move_budget   20,000,256    3,603 ms      430.0
 *   30,000,000    converged     23,791,104    4,293 ms      430.0
 *   50,000,000    converged     23,791,104    4,283 ms      430.0
 *
 * The instance CONVERGES at 23.79 million moves, in 4.3 seconds. At the old
 * default it was being cut off at 21% of that, and the run ended on
 * `move_budget` every time.
 *
 * 50,000,000 buys nothing — converged is converged, and the two runs are
 * identical down to the move count — while costing ~9 s on any instance that
 * does NOT converge, which is too close to the wall cap (see below).
 *
 * THE CLAIM THIS REPLACES WAS FALSE, AND THAT IS THE POINT
 * -------------------------------------------------------
 * This comment previously ended: "Small instances never reach it at all. The
 * stagnation limit is 200 + 20 x placements, so a real tenant's ~276-placement
 * term converges out long before five million moves are spent."
 *
 * It does not. The same tenant needs 23.79 million. The stagnation limit counts
 * ITERATIONS without improvement, not moves, and each LNS iteration evaluates
 * many thousands of moves — so the two are not comparable quantities and the
 * inference never held. It read as a measurement and was a guess, which is
 * exactly the drift CLAUDE.md warns about for prose nothing checks.
 *
 * WHY THE WALL BUDGET RISES TO 30 SECONDS
 * ---------------------------------------
 * It is still the safety cap rather than the operating limit, and it has to stay
 * that way: only a `move_budget` or `converged` termination is reproducible,
 * because how many moves fit in a second is not a property of the input
 * (CLAUDE.md, "Determinism"). So the MOVE budget must be the one that binds.
 *
 * At ~5.5M moves/second on this machine, an instance that does not converge
 * spends ~5.4 s reaching 30,000,000. Against the old 10 s cap that is only 1.85x
 * headroom, so hardware twice as slow would terminate on the clock and lose
 * reproducibility. 30 s restores ~5.5x, matching the margin the previous default
 * was chosen with.
 *
 * A run does not become slower because the cap is higher — the demo tenant still
 * finishes in 4.3 s by converging. The cap only bounds the pathological case.
 */
export const DEFAULT_MAX_MOVES = 100_000_000;

/** Backstop only — see above. Whichever budget is hit first ends the run. */
export const DEFAULT_MAX_WALL_MILLIS = 80_000;

/**
 * How many Rooms one Session can carry across the wire.
 *
 * `crates/core/src/solution.rs` stores a primary Room plus
 * `MAX_ADDITIONAL_ROOMS = 3` extras in a fixed-size array, so four is the whole
 * capacity. Beyond it `convert.rs` TRUNCATES rather than refusing — warn and
 * allow, like the rest of that module — and says nothing on the wire about
 * having done so.
 *
 * Declared here rather than as a literal at the one call site for the reason
 * this file exists at all: it is a fact about the solver, and the next person to
 * raise `MAX_ADDITIONAL_ROOMS` needs one place to look for what agrees with it.
 */
export const MAX_WIRE_ROOMS_PER_SESSION = 4;
