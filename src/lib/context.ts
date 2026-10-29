import { format } from 'winston';
import { Context, ContextValue } from './logger.types';

let context: Context = {};
let entries: [string, ContextValue][] = [];

/**
 * Merged rather than replaced, so a library configuring one field and an application
 * configuring another don't clobber each other.
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
export const contextFormat = format((info) => {
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
