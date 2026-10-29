import { Context, ContextResolver } from './logger.types';
import { bound } from './serialize';

/** Fields every entry already has. Pino writes them separately, so a context key with the same name would duplicate them. */
const BUILT_IN_FIELDS = new Set([
    'level',
    'time',
    'pid',
    'hostname',
    'service',
    'module',
    'action',
    'msg',
    'data',
    'err',
]);

let context: Context = {};
let entries: [string, unknown][] = [];

/**
 * Add name/value pairs to every log entry, from every logger. Call once at startup;
 * order relative to `init` doesn't matter.
 *
 * Values can be static or resolver functions. Resolvers run on every log entry, so
 * request-scoped values (e.g. from `AsyncLocalStorage`) are correct per line. Values that
 * are, or resolve to, `undefined` are omitted, and a resolver that throws is treated the
 * same way. Context never overwrites built-in fields like `msg` or `service`.
 *
 * Calls are merged rather than replaced, so a library configuring one field and an
 * application configuring another don't clobber each other. Pass a key as `undefined`
 * to remove it.
 *
 * @example
 * ```ts
 * logger.configureContext({
 *     'x-context-id-1': 'x-context-value-1',
 *     'x-context-id-2': () => requestStore.getStore()?.contextValue,
 * });
 * ```
 */
export function configureContext(newContext: Context): void {
    context = { ...context, ...newContext };
    entries = Object.entries(context).filter(
        ([key, value]) => value !== undefined && !BUILT_IN_FIELDS.has(key),
    );
}

function isResolver(value: unknown): value is ContextResolver {
    return typeof value === 'function';
}

/** Logging must never crash the caller, so a throwing resolver is treated as unset. */
function resolve(value: unknown): unknown {
    if (!isResolver(value)) return value;
    try {
        return value();
    } catch {
        return undefined;
    }
}

/** The configured context for one entry, with resolvers run and values bounded. */
export function resolveContext(): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of entries) {
        const result = resolve(value);
        if (result !== undefined) {
            resolved[key] = bound(result);
        }
    }
    return resolved;
}

export function _resetContextForTesting(): void {
    context = {};
    entries = [];
}
