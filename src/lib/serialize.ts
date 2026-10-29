/**
 * Without caps, logging a Koa context or an axios error turns one log call into
 * megabytes of blocking `JSON.stringify` on the request path. Pino serializes in full,
 * so values are bounded before they reach it. Truncation is marked in the output rather
 * than silent.
 *
 * Depth counts from the root of the entry, where top-level fields like `data` are
 * level 1.
 */
const MAX_DEPTH = 10;
const MAX_BREADTH = 100;

interface JsonConvertible {
    toJSON(): unknown;
}

function isJsonConvertible(value: object): value is JsonConvertible {
    return typeof (value as Partial<JsonConvertible>).toJSON === 'function';
}

function notStringified(count: number): string {
    return `${count} item${count === 1 ? '' : 's'} not stringified`;
}

/**
 * A copy of `value` that is safe and cheap to serialize: capped in depth and breadth,
 * with circular references marked and bigints quoted so they keep their precision.
 */
export function bound(value: unknown): unknown {
    try {
        return walk(value, 1, []);
    } catch {
        return '[Unserializable]';
    }
}

function toPlain(value: unknown): unknown {
    return typeof value === 'object' &&
        value !== null &&
        isJsonConvertible(value)
        ? value.toJSON()
        : value;
}

function walk(raw: unknown, depth: number, ancestors: object[]): unknown {
    const value = toPlain(raw);
    if (typeof value === 'bigint') return value.toString();
    if (typeof value !== 'object' || value === null) return value;
    if (ancestors.includes(value)) return '[Circular]';
    if (depth >= MAX_DEPTH) {
        return Array.isArray(value) ? '[Array]' : '[Object]';
    }

    ancestors.push(value);
    let result: unknown;
    if (Array.isArray(value)) {
        const items: unknown[] = value
            .slice(0, MAX_BREADTH)
            .map((item) => walk(item, depth + 1, ancestors));
        if (value.length > MAX_BREADTH) {
            items.push(`... ${notStringified(value.length - MAX_BREADTH)}`);
        }
        result = items;
    } else {
        const keys = Object.keys(value);
        const fields: [string, unknown][] = keys
            .slice(0, MAX_BREADTH)
            .map((key) => [
                key,
                walk(
                    (value as Record<string, unknown>)[key],
                    depth + 1,
                    ancestors,
                ),
            ]);
        if (keys.length > MAX_BREADTH) {
            fields.push(['...', notStringified(keys.length - MAX_BREADTH)]);
        }
        result = Object.fromEntries(fields);
    }
    ancestors.pop();
    return result;
}
