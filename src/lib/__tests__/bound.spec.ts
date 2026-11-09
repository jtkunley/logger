import { describe, expect, it, vi } from 'vitest';
import { boundValue, UNSERIALIZABLE } from '../bound';

/** `{ leaf }` wrapped `n` times in an object with one property. */
function nested(n: number, leaf: unknown = 'bottom'): Record<string, unknown> {
    let value: Record<string, unknown> = { leaf };
    for (let i = 0; i < n; i++) {
        value = { next: value };
    }
    return value;
}

/** Follows `next` down `n` levels. */
function descend(value: unknown, n: number): Record<string, unknown> {
    let current = value as Record<string, unknown>;
    for (let i = 0; i < n; i++) {
        current = current['next'] as Record<string, unknown>;
    }
    return current;
}

const range = (length: number) => Array.from({ length }, (_, i) => i);

describe('boundValue', () => {
    it('returns primitives as they are', () => {
        for (const value of ['text', 1, 0, true, false, null, undefined]) {
            expect(boundValue(value)).toBe(value);
        }
    });

    describe('depth', () => {
        it('keeps nested(8) down to its leaf', () => {
            const bounded = boundValue(nested(8));

            expect(descend(bounded, 8)).toEqual({ leaf: 'bottom' });
            expect(JSON.stringify(bounded)).not.toContain('[Object]');
        });

        it('replaces the object at depth 10 in nested(9) with [Object]', () => {
            const bounded = boundValue(nested(9));

            expect(descend(bounded, 8)).toEqual({ next: '[Object]' });
            expect(JSON.stringify(bounded)).not.toContain('bottom');
        });

        it('replaces an array at depth 10 with [Array]', () => {
            expect(descend(boundValue(nested(8, ['bottom'])), 8)).toEqual({ leaf: '[Array]' });
        });

        it('keeps primitives at depth 10', () => {
            expect(descend(boundValue(nested(8, 42n)), 8)).toEqual({ leaf: '42' });
        });
    });

    describe('arrays', () => {
        it('keeps an array of 100 items in full', () => {
            expect(boundValue(range(100))).toEqual(range(100));
        });

        it('keeps the first 100 of 101 items and appends a marker', () => {
            expect(boundValue(range(101))).toEqual([...range(100), '... 1 item not stringified']);
        });

        it('counts every omitted item in the marker', () => {
            expect(boundValue(range(105))).toEqual([...range(100), '... 5 items not stringified']);
        });

        it('bounds the items it keeps', () => {
            expect(boundValue([1n, { big: 2n }])).toEqual(['1', { big: '2' }]);
        });
    });

    describe('objects', () => {
        const wide = (keys: number) =>
            Object.fromEntries(range(keys).map((i) => [`key${i}`, i])) as Record<string, number>;

        it('keeps an object with 100 keys in full', () => {
            expect(boundValue(wide(100))).toEqual(wide(100));
        });

        it('keeps the first 100 of 101 keys and adds a "..." marker', () => {
            const bounded = boundValue(wide(101)) as Record<string, unknown>;

            expect(bounded).not.toHaveProperty('key100');
            expect(bounded['key99']).toBe(99);
            expect(bounded['...']).toBe('1 item not stringified');
        });

        it('counts every omitted key in the marker', () => {
            expect((boundValue(wide(103)) as Record<string, unknown>)['...']).toBe(
                '3 items not stringified',
            );
        });

        it('keeps an own __proto__ key as an ordinary property', () => {
            const bounded = boundValue(JSON.parse('{"__proto__":{"polluted":true},"ok":1}'));

            expect(Object.getPrototypeOf(bounded)).toBe(Object.prototype);
            expect(JSON.parse(JSON.stringify(bounded))).toEqual(
                JSON.parse('{"__proto__":{"polluted":true},"ok":1}'),
            );
            expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
        });
    });

    describe('references', () => {
        it('replaces a reference to an ancestor with [Circular]', () => {
            const value: Record<string, unknown> = { key: 'value' };
            value['self'] = value;

            expect(boundValue(value)).toEqual({ key: 'value', self: '[Circular]' });
        });

        it('replaces a cycle through an array with [Circular]', () => {
            const value: unknown[] = ['a'];
            value.push({ back: value });

            expect(boundValue(value)).toEqual(['a', { back: '[Circular]' }]);
        });

        it('includes an object shared by two branches in both', () => {
            const shared = { id: 1 };

            expect(boundValue({ a: shared, b: [shared] })).toEqual({
                a: { id: 1 },
                b: [{ id: 1 }],
            });
        });
    });

    describe('special values', () => {
        it('turns a BigInt into its exact decimal string', () => {
            expect(boundValue({ big: 12345678901234567890n })).toEqual({
                big: '12345678901234567890',
            });
        });

        it('logs a Date as its ISO string', () => {
            expect(boundValue({ at: new Date('2026-01-01T00:00:00.000Z') })).toEqual({
                at: '2026-01-01T00:00:00.000Z',
            });
        });

        it('bounds the result of toJSON', () => {
            const value = { toJSON: () => ({ big: 1n, list: range(101) }) };

            expect(boundValue(value)).toEqual({
                big: '1',
                list: [...range(100), '... 1 item not stringified'],
            });
        });
    });

    describe('failures', () => {
        it('replaces the whole value with [Unserializable] when a getter throws', () => {
            const value = {
                fine: 1,
                get broken(): never {
                    throw new Error('getter');
                },
            };

            expect(boundValue(value)).toBe(UNSERIALIZABLE);
        });

        it('replaces the whole value with [Unserializable] when toJSON throws', () => {
            expect(
                boundValue({
                    toJSON() {
                        throw new Error('toJSON');
                    },
                }),
            ).toBe(UNSERIALIZABLE);
        });
    });

    describe('input', () => {
        it('leaves the caller’s objects and arrays unchanged', () => {
            const list = range(101);
            const value: Record<string, unknown> = { big: 1n, list, deep: nested(9) };
            value['self'] = value;
            const snapshot = { ...value };

            boundValue(value);

            expect(value).toEqual(snapshot);
            expect(value['self']).toBe(value);
            expect(list).toHaveLength(101);
            expect(JSON.stringify(nested(9))).toContain('bottom');
        });

        it('reads getters and calls toJSON, with whatever side effects they have', () => {
            const toJSON = vi.fn(() => 'json');
            const getter = vi.fn(() => 'got');
            const value = { nested: { toJSON } };
            Object.defineProperty(value, 'computed', { get: getter, enumerable: true });

            expect(boundValue(value)).toEqual({ nested: 'json', computed: 'got' });
            expect(toJSON).toHaveBeenCalledTimes(1);
            expect(getter).toHaveBeenCalledTimes(1);
        });
    });

    describe('limits', () => {
        it('does not cap string length', () => {
            const long = 'x'.repeat(100_000);

            expect(boundValue({ long })).toEqual({ long });
        });

        it('has no total size budget beyond depth and breadth', () => {
            const grid = range(100).map(() => range(100));

            expect(boundValue(grid)).toEqual(grid);
        });
    });
});
