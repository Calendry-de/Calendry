import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { RESOURCES } from '../server/utils/resources';
import { RELATIONS } from '../server/utils/relations';

/**
 * Pins the generic CRUD family's `defineRouteMeta` OpenAPI schemas to the two
 * registries that actually decide what those routes accept.
 *
 * CLAUDE.md already requires a field added to a route's request shape to be
 * added to its OpenAPI schema in the same change. That was a rule checked by
 * nobody, and it drifted exactly the way prose drifts: `requiredLecturerCount`
 * shipped on Offering and OfferingTemplate, in create AND update, and was
 * absent from all four schemas, so the docs described an API that could not
 * express "one of these three lecturers, not all three". Nothing failed;
 * `defineRouteMeta` takes an object literal and never sees the zod schema.
 *
 * A pure unit test: it needs no server and no database. It imports the route
 * MODULES with Nitro's compile-time macros stubbed on `globalThis`, so it reads
 * the meta Nitro would emit rather than a copy of it.
 *
 * NOT ASSERTED HERE: `nullable`. `z.coerce.date()` accepts null (`new Date(null)`
 * is the epoch), so deriving nullability by parsing null would demand the docs
 * claim four date fields are nullable, which is a coercion artifact rather than
 * part of the contract.
 */

interface OpenApiVariant {
    title?: string;
    required?: string[];
    properties?: Record<string, unknown>;
}

interface RouteMeta {
    openAPI: {
        parameters?: { name: string; in: string }[];
        requestBody?: {
            content: {
                'application/json': {
                    schema: {
                        oneOf?: OpenApiVariant[];
                        items?: { oneOf?: OpenApiVariant[] };
                    };
                };
            };
        };
    };
}

/**
 * MEMOISED, because ES modules execute once: a second `import()` of a route
 * already loaded by an earlier test returns the cached module and declares
 * nothing, which would read as "this route has no meta".
 */
const metaCache = new Map<string, RouteMeta>();

/**
 * Imports a route module with the macros Nitro injects stubbed out, capturing
 * the meta it declares. `defineRouteMeta` is a compile-time macro: at runtime
 * it is simply an undefined global, so the import throws without this.
 */
async function routeMeta(key: string, load: () => Promise<unknown>): Promise<RouteMeta> {
    const cached = metaCache.get(key);

    if (cached) {
        return cached;
    }

    const captured: RouteMeta[] = [];
    const globals = globalThis as Record<string, unknown>;

    globals.defineRouteMeta = (meta: RouteMeta) => {
        captured.push(meta);
    };
    globals.defineEventHandler = (handler: unknown) => handler;

    await load();

    expect(captured, `${key} declared exactly one defineRouteMeta`).toHaveLength(1);
    metaCache.set(key, captured[0] as RouteMeta);

    return captured[0] as RouteMeta;
}

/** Top-level keys of a `z.object`, in declaration order. */
function schemaKeys(schema: z.ZodTypeAny): string[] {
    const shape = (schema as unknown as { shape?: Record<string, z.ZodTypeAny> }).shape;

    expect(shape, 'schema is a z.object').toBeTypeOf('object');

    return Object.keys(shape as Record<string, z.ZodTypeAny>);
}

/**
 * The keys a body MUST carry, derived by asking the schema rather than by
 * reading `.isOptional()`: `z.preprocess` wrappers hide that flag, and two of
 * the offering fields are wrapped in one.
 */
function requiredKeys(schema: z.ZodTypeAny): string[] {
    const shape = (schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;

    return Object.keys(shape).filter((key) => !shape[key].safeParse(undefined).success).sort();
}

function byTitle(variants: OpenApiVariant[]): Map<string, OpenApiVariant> {
    return new Map(variants.map((variant) => [variant.title as string, variant]));
}

function assertVariantMatches(label: string, variant: OpenApiVariant, schema: z.ZodTypeAny): void {
    expect(Object.keys(variant.properties ?? {}).sort(), `${label} documented properties`)
        .toEqual(schemaKeys(schema).sort());
    expect([...(variant.required ?? [])].sort(), `${label} documented required`)
        .toEqual(requiredKeys(schema));
}

describe('generic CRUD OpenAPI meta', () => {
    it('documents every create field of every resource, and no others', async () => {
        const meta = await routeMeta('index.post', () => import('../server/api/[resource]/index.post'));
        const schema = meta.openAPI.requestBody?.content['application/json'].schema;
        const variants = byTitle(schema?.oneOf ?? []);

        expect([...variants.keys()].sort(), 'a oneOf variant per resource').toEqual(Object.keys(RESOURCES).sort());

        for (const [name, config] of Object.entries(RESOURCES)) {
            assertVariantMatches(`create ${name}`, variants.get(name) as OpenApiVariant, config.create);
        }
    });

    it('documents every update field of every resource, and no others', async () => {
        const meta = await routeMeta('[id].patch', () => import('../server/api/[resource]/[id].patch'));
        const schema = meta.openAPI.requestBody?.content['application/json'].schema;
        const variants = byTitle(schema?.oneOf ?? []);

        expect([...variants.keys()].sort(), 'a oneOf variant per resource').toEqual(Object.keys(RESOURCES).sort());

        for (const [name, config] of Object.entries(RESOURCES)) {
            assertVariantMatches(`update ${name}`, variants.get(name) as OpenApiVariant, config.update);
        }
    });

    it('documents every relation item field of every relation, and no others', async () => {
        const meta = await routeMeta('[relation].put', () => import('../server/api/[resource]/[id]/[relation].put'));
        const schema = meta.openAPI.requestBody?.content['application/json'].schema;
        const variants = byTitle(schema?.items?.oneOf ?? []);

        expect([...variants.keys()].sort(), 'a oneOf variant per relation').toEqual(Object.keys(RELATIONS).sort());

        for (const [name, config] of Object.entries(RELATIONS)) {
            assertVariantMatches(`relation ${name}`, variants.get(name) as OpenApiVariant, config.item);
        }
    });

    /*
     * The list route's filters are per-resource but its meta is one literal, so
     * the parameter list is their UNION and each description names the resources
     * that accept it. Only coverage is checkable here; the naming is not.
     */
    it('documents every per-resource list filter as a query parameter', async () => {
        const meta = await routeMeta('index.get', () => import('../server/api/[resource]/index.get'));
        const documented = new Set((meta.openAPI.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name));

        for (const [name, config] of Object.entries(RESOURCES)) {
            for (const filter of schemaKeys(config.filters)) {
                expect(documented.has(filter), `${name} filter ${filter} is a documented query parameter`).toBe(true);
            }
        }
    });

    /*
     * Every one of these routes names the resource segment as a path enum, and a
     * resource missing from it is undocumented however complete its body schema
     * is: nothing tells a reader the path exists.
     */
    it('lists every resource in each route path enum', async () => {
        const routes: [string, () => Promise<unknown>][] = [
            ['index.get', () => import('../server/api/[resource]/index.get')],
            ['index.post', () => import('../server/api/[resource]/index.post')],
            ['[id].get', () => import('../server/api/[resource]/[id].get')],
            ['[id].patch', () => import('../server/api/[resource]/[id].patch')],
            ['[id].delete', () => import('../server/api/[resource]/[id].delete')],
            ['[relation].get', () => import('../server/api/[resource]/[id]/[relation].get')],
            ['[relation].put', () => import('../server/api/[resource]/[id]/[relation].put')],
        ];

        for (const [label, load] of routes) {
            const meta = await routeMeta(label, load);
            const parameter = (meta.openAPI.parameters ?? []).find((p) => p.name === 'resource') as
                { schema?: { enum?: string[] } } | undefined;

            expect([...(parameter?.schema?.enum ?? [])].sort(), `${label} resource enum`)
                .toEqual(Object.keys(RESOURCES).sort());
        }
    });
});
