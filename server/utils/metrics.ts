import { Counter, Histogram, collectDefaultMetrics, register } from 'prom-client';

/**
 * Prometheus metrics for this process, on prom-client's own default
 * registry. `/metrics` (`server/routes/metrics.get.ts`) serves exactly this
 * registry, so anything registered against it (the two metrics below, plus
 * prom-client's own process metrics) shows up there with no further wiring.
 *
 * `collectDefaultMetrics()` adds the standard Node.js process metrics
 * (heap, event loop lag, GC, open file descriptors) prom-client ships built
 * in: the usual baseline for a "real" `/metrics` endpoint, not just the two
 * HTTP metrics this issue asks for as a minimum.
 */
collectDefaultMetrics({ register });

const LABEL_NAMES = ['method', 'route', 'status_code'] as const;

/**
 * Labelled by ROUTE PATTERN and status code, never by a raw dynamic path
 * segment (a session id, an account id), which would make cardinality grow
 * with the number of database rows instead of the number of routes.
 * `normalizeRoute()` below is what keeps that true; the metrics middleware
 * (`server/middleware/metrics.ts`) is the only caller.
 */
export const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests received.',
    labelNames: LABEL_NAMES,
    registers: [register],
});

export const httpRequestDurationSeconds = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds.',
    labelNames: LABEL_NAMES,
    // Wide enough to separate a cache-hit API read (a few ms) from a slower
    // one waiting on the database or the solver, without per-route buckets.
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register],
});

export { register as metricsRegistry };

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SEGMENT = /^\d+$/;

/**
 * Collapses a raw request path to a route SHAPE, so the label set stays
 * bounded by the number of routes rather than the number of rows in the
 * database: `/api/sessions/<uuid>` and `/api/accounts/<uuid>` both become
 * `/api/sessions/:id` and `/api/accounts/:id`.
 *
 * A COARSER GROUPING, deliberately, rather than Nitro's matched route
 * template: file-based API routes here go through Nitro's own radix router
 * (not h3's `createRouter()`), which does not set `event.context.matchedRoute`
 * (verified against nitropack's runtime, where that property only exists on
 * the unrelated h3 router helper). Every id in this schema is a `uuid(7)`
 * (`prisma/schema.prisma`), so the UUID pattern alone covers every dynamic
 * segment in the app; the numeric fallback is a second, cheap net for
 * anything that is not.
 */
export function normalizeRoute(rawPath: string): string {
    const path = rawPath.split('?')[0] || '/';

    const normalized = path
        .split('/')
        .map((segment) => (UUID_SEGMENT.test(segment) || NUMERIC_SEGMENT.test(segment) ? ':id' : segment))
        .join('/');

    return normalized || '/';
}
