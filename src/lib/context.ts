import { boundValue, setProperty } from './bound';
import type { LogContext } from './types';

/** Fields every entry already has; context can neither replace nor repeat them. */
const RESERVED = new Set([
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

/** Shared by every root logger created from this copy of the library. */
const configured = new Map<string, unknown>();

/**
 * Merges fields into the context added to every entry. A function is called
 * for each entry; a key set to `undefined` is removed.
 */
export function configureContext(context: LogContext): void {
    for (const [key, value] of Object.entries(context)) {
        if (RESERVED.has(key)) {
            continue;
        }
        if (value === undefined) {
            configured.delete(key);
        } else {
            configured.set(key, value);
        }
    }
}

/**
 * The context fields for one entry. A resolver that throws or returns
 * `undefined` leaves its field out.
 */
export function resolveContext(): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [key, entry] of configured) {
        let value = entry;
        if (typeof entry === 'function') {
            try {
                value = (entry as () => unknown)();
            } catch {
                continue;
            }
        }
        if (value !== undefined) {
            setProperty(resolved, key, boundValue(value));
        }
    }
    return resolved;
}
