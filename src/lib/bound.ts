/** An object or array at this depth, counting the logged value as 1, is replaced by a marker. */
const MAX_DEPTH = 10;
/** Items or keys kept per array or object; the rest are counted in a marker. */
const MAX_BREADTH = 100;

export const UNSERIALIZABLE = '[Unserializable]';

/**
 * Copies a value into a form that serializes with bounded depth and breadth,
 * without cycles or BigInts. A value that throws while being read becomes
 * `[Unserializable]`. The caller's objects are left as they are.
 */
export function boundValue(value: unknown): unknown {
    try {
        return bound(value, 1, []);
    } catch {
        return UNSERIALIZABLE;
    }
}

/** Sets a key on a plain object, keeping `__proto__` as an ordinary property. */
export function setProperty(target: Record<string, unknown>, key: string, value: unknown): void {
    if (key === '__proto__') {
        Object.defineProperty(target, key, {
            value,
            enumerable: true,
            writable: true,
            configurable: true,
        });
    } else {
        target[key] = value;
    }
}

function bound(value: unknown, depth: number, ancestors: object[]): unknown {
    if (hasToJSON(value)) {
        value = value.toJSON();
    }
    if (typeof value === 'bigint') {
        return value.toString();
    }
    if (typeof value !== 'object' || value === null) {
        return value;
    }
    if (ancestors.includes(value)) {
        return '[Circular]';
    }
    if (depth >= MAX_DEPTH) {
        return Array.isArray(value) ? '[Array]' : '[Object]';
    }

    ancestors.push(value);
    const result = Array.isArray(value)
        ? boundArray(value, depth, ancestors)
        : boundObject(value as Record<string, unknown>, depth, ancestors);
    ancestors.pop();
    return result;
}

function boundArray(value: unknown[], depth: number, ancestors: object[]): unknown[] {
    const kept = Math.min(value.length, MAX_BREADTH);
    const result: unknown[] = [];
    for (let index = 0; index < kept; index++) {
        result.push(bound(value[index], depth + 1, ancestors));
    }
    if (value.length > kept) {
        result.push(`... ${notStringified(value.length - kept)}`);
    }
    return result;
}

function boundObject(
    value: Record<string, unknown>,
    depth: number,
    ancestors: object[],
): Record<string, unknown> {
    const keys = Object.keys(value);
    const result: Record<string, unknown> = {};
    for (const key of keys.slice(0, MAX_BREADTH)) {
        setProperty(result, key, bound(value[key], depth + 1, ancestors));
    }
    if (keys.length > MAX_BREADTH) {
        result['...'] = notStringified(keys.length - MAX_BREADTH);
    }
    return result;
}

function notStringified(count: number): string {
    return `${count} ${count === 1 ? 'item' : 'items'} not stringified`;
}

function hasToJSON(value: unknown): value is { toJSON(): unknown } {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { toJSON?: unknown }).toJSON === 'function'
    );
}
