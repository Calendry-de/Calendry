/**
 * Facts about the login plane that the browser and the server must agree on.
 *
 * Currently one number, and it earns a file rather than a literal in two places
 * for the reason `shared/password.ts` does: the endpoint caps its result and the
 * form REPORTS that cap, so a copy that drifts turns an honest "there are more"
 * into a message that fires at the wrong size — or stops firing at all.
 *
 * Deliberately not `server/api/accounts/candidates.get.ts`, even though that is
 * where the cap is applied: importing a Nitro handler from a component pulls
 * `defineEventHandler` and the whole route into the client bundle.
 */

/**
 * How many unattached people `/api/accounts/candidates` returns.
 *
 * Small on purpose — the list holds only people WITHOUT a login, which in a
 * settled institution is short. An onboarding tenant that has imported thousands
 * and issued nothing yet will hit it, which is why the form says so instead of
 * presenting 500 of 3,000 as the roster. Proper fix is a searchable picker:
 * the project board, "A searchable person picker".
 */
export const CANDIDATE_LIMIT = 500;
