/**
 * The two things a solver run can be asked to do, and the one number that
 * separates them.
 *
 * ONE MECHANISM, TWO INSTRUCTIONS. Solver ADR-0008: a request carries a scope
 * (what is actively being placed) plus a policy for everything outside it.
 * There is no "repair mode" in the solver — a repair is that same mechanism
 * given the opposite instruction:
 *
 *   rebuild   scope = every active Offering, everything outside hard-locked.
 *             There IS nothing outside, so the policy governs nothing.
 *   repair    scope = empty, everything outside softly penalised. EVERY Session
 *             is outside, so every Session may move and every move costs.
 *
 * The vocabulary lives in `shared/` because the route and the toolbar must
 * agree on it — the same reason `solverBudget.ts` exists, and the same failure
 * if they do not: two string literals that happen to match until one changes.
 */
export const SOLVER_MODES = ['rebuild', 'repair'] as const;

export type SolverMode = (typeof SOLVER_MODES)[number];

/**
 * What disturbing one already-placed Session costs, as a soft weight.
 *
 * THIS NUMBER IS NOT MEASURED, and saying so is the point — the file next door
 * documents a comment that "read as a measurement and was a guess", which is
 * exactly the drift CLAUDE.md warns about for prose nothing checks. What is
 * reasoned rather than measured:
 *
 * - Enabled SOFT constraints in `constraintTypes.ts` carry `defaultWeight`
 *   between 3 and 8, so 20 prices one move at roughly three soft breaches:
 *   biased against moving, not forbidden from it.
 * - It cannot suppress a repair. The solver derives
 *   `hard_penalty = sum(weights) * placements + 1`, which is four orders of
 *   magnitude larger on a real term, so a move that clears a hard violation is
 *   always worth paying for however this is tuned. Only soft-gain churn is
 *   being suppressed here.
 *
 * TO REPLACE IT WITH A MEASUREMENT: run a repair on a real term with a known
 * clash at several weights, comparing `moved` in the plan against the number of
 * violations actually cleared. The useful value is the largest weight that
 * still clears them. Compare only `move_budget` or `converged` runs — a
 * `time_budget` comparison is not evidence (CLAUDE.md, "Determinism") — and
 * restart the solver between runs, or the idempotency registry replays the
 * first one.
 */
export const REPAIR_MOVEMENT_WEIGHT = 20;
