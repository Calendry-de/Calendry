import { metricsRegistry } from '../utils/metrics';

/**
 * Prometheus scrape endpoint. Serves `metricsRegistry` (prom-client's own
 * default registry) in Prometheus text exposition format — every metric
 * registered anywhere in the process (the two in `server/utils/metrics.ts`,
 * plus prom-client's built-in process metrics) shows up here with no further
 * wiring.
 *
 * Deliberately outside `withRequestTenant` — a scrape is unauthenticated
 * infrastructure traffic with no tenant context, the same category as
 * `/api/health`, and the metrics themselves carry no tenant-scoped data.
 */
export default defineEventHandler(async (event) => {
    setResponseHeader(event, 'Content-Type', metricsRegistry.contentType);

    return metricsRegistry.metrics();
});
