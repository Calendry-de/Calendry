/**
 * Row shapes of the staff routes, shared by the staff page and its panels so
 * the four components describe `GET /api/staff/tenants` and
 * `GET /api/staff/federations` once. `request<T>()` is an unchecked claim
 * about what the server sends (CLAUDE.md), so these are pinned to the
 * routes' own OpenAPI meta rather than widened per component.
 */
export interface StaffTenant {
    id: string;
    slug: string;
    name: string;
    timezone: string;
    createdAt: string;
    /** `TenantDisplaySettings.defaultLocale`, flattened by the list route. */
    defaultLocale: string | null;
    federation: { id: string; slug: string; name: string } | null;
}

export interface StaffFederation {
    id: string;
    slug: string;
    name: string;
    createdAt: string;
    tenants: { id: string; slug: string; name: string }[];
}
