import { format } from 'winston';
import { Context, ContextValue } from './logger.types';

let context: Context = {};
let entries: [string, ContextValue][] = [];

/**
 * Add name/value pairs to every log entry, from every logger. Call once at startup;
 * order relative to `init` doesn't matter.
 *
 * Values can be static or resolver functions. Resolvers run on every log entry, so
 * request-scoped values (e.g. from `AsyncLocalStorage`) are correct per line. Values that
 * are, or resolve to, `undefined` are omitted, and a resolver that throws is treated the
 * same way. Context never overwrites built-in fields like `message` or `service`.
 *
 * Calls are merged rather than replaced, so a library configuring one field and an
 * application configuring another don't clobber each other. Pass a key as `undefined`
 * to remove it.
 *
 * @example
 * ```ts
 * logger.configureContext({
 *     tier: process.env.TIER,
 *     correlationId: () => requestStore.getStore()?.correlationId,
 * });
 * ```
 */
export function configureContext(newContext: Context): void {
    context = { ...context, ...newContext };
    entries = Object.entries(context).filter(
        (entry): entry is [string, ContextValue] => entry[1] !== undefined,
    );
}

/** Logging must never crash the caller, so a throwing resolver is treated as unset. */
function resolve(value: ContextValue): unknown {
    if (typeof value !== 'function') return value;
    try {
        return value();
    } catch {
        return undefined;
    }
}

/** Context never overwrites existing fields, so a context key can't corrupt the log shape. */
export const contextFormat: ReturnType<typeof format> = format((info) => {
    for (const [key, value] of entries) {
        if (key in info) continue;
        const resolved = resolve(value);
        if (resolved !== undefined) {
            info[key] = resolved;
        }
    }
    return info;
});

export function _resetContextForTesting(): void {
    context = {};
    entries = [];
}
