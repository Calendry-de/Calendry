import { httpRequestDurationSeconds, httpRequestsTotal, normalizeRoute } from '../utils/metrics';

/**
 * Wraps every request with a request counter and a duration histogram,
 * scraped at `/metrics` (`server/routes/metrics.get.ts`). Registered the same
 * way `security-headers.ts` is: Nitro auto-loads every file under
 * `server/middleware/` in filename order, so nothing else has to import this.
 *
 * The label set and the timing are captured from the response's `finish`
 * event, not computed here and returned: middleware runs BEFORE the route
 * handler, so the final status code does not exist yet at this point.
 */
export default defineEventHandler((event) => {
    const startedAt = process.hrtime.bigint();

    event.node.res.on('finish', () => {
        const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
        const labels = {
            method: event.node.req.method ?? 'UNKNOWN',
            route: normalizeRoute(event.path ?? event.node.req.url ?? ''),
            status_code: String(event.node.res.statusCode),
        };

        httpRequestsTotal.inc(labels);
        httpRequestDurationSeconds.observe(labels, durationSeconds);
    });
});
