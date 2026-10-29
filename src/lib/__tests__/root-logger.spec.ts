import { vi } from 'vitest';

import { configureContext, _resetContextForTesting } from '../context';
import type { Destination } from '../destination';
import type { LoggerLevel } from '../logger.types';
import { createRootLogger } from '../root-logger';

type Entry = Record<string, unknown>;

const PINO_LEVELS = { 20: 'debug', 30: 'info', 40: 'warn', 50: 'error' };

let lines: string[];
let destination: Destination;

function entries(): Entry[] {
    return lines.map((line) => JSON.parse(line) as Entry);
}

function levels(): unknown[] {
    return entries().map(
        (entry) => PINO_LEVELS[entry['level'] as keyof typeof PINO_LEVELS],
    );
}

function onlyEntry(): Entry {
    expect(lines).toHaveLength(1);
    return entries()[0];
}

function loggedData(): Record<string, unknown> {
    return onlyEntry()['data'] as Record<string, unknown>;
}

function rootLogger(level: LoggerLevel = 'info') {
    return createRootLogger('SampleServiceName', level, destination);
}

function childLogger(level?: LoggerLevel) {
    return rootLogger(level).child('someService', 'someAction');
}

function logAtEveryLevel(logger: ReturnType<typeof childLogger>) {
    logger.debug('debug message', {});
    logger.info('info message', {});
    logger.warn('warn message', {});
    logger.error('error message', new Error('oops'), {});
}

function nested(depth: number): Record<string, unknown> {
    let value: Record<string, unknown> = { leaf: 'bottom' };
    for (let i = 0; i < depth; i++) {
        value = { [`level${i}`]: value };
    }
    return value;
}

const baseEntry = {
    module: 'someService',
    action: 'someAction',
    service: 'SampleServiceName',
    hostname: expect.any(String),
    pid: process.pid,
    time: expect.any(Number),
};

describe('RootLogger', () => {
    beforeEach(() => {
        lines = [];
        destination = {
            write: (line) => lines.push(line),
            flush: (callback) => {
                callback();
            },
        };
    });
    afterEach(() => {
        vi.useRealTimers();
        _resetContextForTesting();
    });

    describe('levels', () => {
        it.each([
            ['error', ['error']],
            ['warn', ['warn', 'error']],
            ['info', ['info', 'warn', 'error']],
            ['debug', ['debug', 'info', 'warn', 'error']],
        ] as const)('at %s, should emit only %j', (level, expected) => {
            logAtEveryLevel(childLogger(level));
            expect(levels()).toEqual(expected);
        });

        it('should dynamically update the log level of existing child loggers', () => {
            const root = rootLogger('info');
            const logger = root.child('someService', 'someAction');
            logger.debug('debug before level change', {});
            expect(lines).toHaveLength(0);

            root.level('debug');
            logger.debug('debug after level change', {});
            expect(onlyEntry()).toEqual(
                expect.objectContaining({
                    level: 20,
                    msg: 'debug after level change',
                }),
            );

            root.level('error');
            logger.warn('warn after level change', {});
            expect(lines).toHaveLength(1);
        });

        it('should not serialize data for entries below the level', () => {
            const data = {
                get key() {
                    throw new Error('should not be read');
                },
            };
            childLogger('warn').info('info message', data);
            expect(lines).toHaveLength(0);
        });
    });

    describe('entries', () => {
        it.each([
            ['debug', 20],
            ['info', 30],
            ['warn', 40],
        ] as const)(
            'should log %s with the standard fields',
            (level, number) => {
                childLogger('debug')[level](`${level} message`, {
                    key: 'value',
                });
                expect(onlyEntry()).toEqual({
                    ...baseEntry,
                    level: number,
                    msg: `${level} message`,
                    data: { key: 'value' },
                });
            },
        );

        it('should log an Error with its type, message, stack, and extra properties', () => {
            const error = Object.assign(new TypeError('oops'), {
                code: 'E_OOPS',
            });
            childLogger().error('error message', error, { key: 'value' });
            expect(onlyEntry()).toEqual({
                ...baseEntry,
                level: 50,
                msg: 'error message',
                data: { key: 'value' },
                err: {
                    type: 'TypeError',
                    message: 'oops',
                    stack: expect.stringContaining('TypeError: oops'),
                    code: 'E_OOPS',
                },
            });
        });

        it('should fold the cause chain into the message and stack', () => {
            const error = new Error('oops', { cause: new Error('root cause') });
            childLogger().error('error message', error, {});
            expect(onlyEntry()['err']).toEqual(
                expect.objectContaining({
                    message: 'oops: root cause',
                    stack: expect.stringContaining(
                        'caused by: Error: root cause',
                    ),
                }),
            );
        });

        it('should bound extra properties on an Error', () => {
            const error = Object.assign(new Error('oops'), {
                response: { items: Array.from({ length: 101 }, (_, i) => i) },
            });
            childLogger().error('error message', error, {});
            expect(JSON.stringify(onlyEntry()['err'])).toContain(
                '"... 1 item not stringified"',
            );
        });

        it.each([
            ['a string', 'plain string'],
            ['an object', { reason: 'denied' }],
        ])('should log a thrown non-Error value (%s) as-is', (_, value) => {
            childLogger().error('error message', value, {});
            expect(onlyEntry()['err']).toEqual(value);
        });

        it('should omit err when undefined was thrown', () => {
            childLogger().error('error message', undefined, {});
            expect(onlyEntry()).not.toHaveProperty('err');
        });

        it('should log the message verbatim, without printf-style formatting', () => {
            childLogger().info('100% done for %s', {});
            expect(onlyEntry()['msg']).toBe('100% done for %s');
        });
    });

    describe('flush', () => {
        it('should resolve once the destination has flushed', async () => {
            let flushed: () => void = () => undefined;
            destination.flush = (callback) => {
                flushed = callback;
            };
            let resolved = false;
            const flushing = rootLogger()
                .flush()
                .then(() => {
                    resolved = true;
                });

            await Promise.resolve();
            expect(resolved).toBe(false);
            flushed();
            await flushing;
            expect(resolved).toBe(true);
        });

        it('should give up after 10 seconds if the destination never flushes', async () => {
            vi.useFakeTimers();
            destination.flush = () => undefined;
            const flushing = rootLogger().flush();
            await vi.advanceTimersByTimeAsync(10_000);
            await expect(flushing).resolves.toBeUndefined();
        });
    });

    describe('context', () => {
        it('should inject configured context into every entry', () => {
            configureContext({
                'x-context-id-1': 'x-context-value-1',
                'x-context-id-2': () => 'x-context-value-2',
            });
            childLogger().info('info message', { key: 'value' });
            expect(onlyEntry()).toEqual({
                ...baseEntry,
                level: 30,
                msg: 'info message',
                'x-context-id-1': 'x-context-value-1',
                'x-context-id-2': 'x-context-value-2',
                data: { key: 'value' },
            });
        });

        it('should inject context at every level', () => {
            configureContext({ 'x-context-id-1': 'x-context-value-1' });
            logAtEveryLevel(childLogger('debug'));
            expect(lines).toHaveLength(4);
            for (const entry of entries()) {
                expect(entry['x-context-id-1']).toBe('x-context-value-1');
            }
        });

        it('should apply context configured after the logger was created', () => {
            const logger = childLogger();
            configureContext({ 'x-context-id-1': 'x-context-value-1' });
            logger.info('info message', {});
            expect(onlyEntry()['x-context-id-1']).toBe('x-context-value-1');
        });

        it('should never overwrite or duplicate built-in fields', () => {
            configureContext(
                Object.fromEntries(
                    [
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
                    ].map((key) => [key, 'x-context-value-1']),
                ),
            );
            childLogger().error('error message', 'failure', {
                key: 'value',
            });
            expect(lines[0]).not.toContain('x-context-value-1');
            expect(onlyEntry()).toEqual({
                ...baseEntry,
                level: 50,
                msg: 'error message',
                err: 'failure',
                data: { key: 'value' },
            });
        });

        it('should not invoke resolvers for entries below the level', () => {
            const resolver = vi.fn(() => 'x-context-value-1');
            configureContext({ 'x-context-id-1': resolver });
            childLogger('info').debug('debug message', {});
            expect(resolver).not.toHaveBeenCalled();
        });

        it('should bound context values', () => {
            configureContext({ 'x-context-id-1': () => nested(9) });
            childLogger().info('info message', {});
            expect(lines[0]).toContain('"[Object]"');
            expect(lines[0]).not.toContain('"bottom"');
        });
    });

    describe('serialization limits', () => {
        it('should serialize data up to 8 levels deep in full', () => {
            childLogger().info('info message', nested(8));
            expect(lines[0]).toContain('"bottom"');
            expect(lines[0]).not.toContain('"[Object]"');
        });

        it('should mark data nested 9 levels deep as truncated', () => {
            childLogger().info('info message', nested(9));
            expect(lines[0]).toContain('"[Object]"');
            expect(lines[0]).not.toContain('"bottom"');
        });

        it('should mark arrays past the depth limit as truncated', () => {
            const data = nested(8);
            let innermost = data;
            while (!('leaf' in innermost)) {
                innermost = Object.values(innermost)[0] as Record<
                    string,
                    unknown
                >;
            }
            innermost['leaf'] = ['bottom'];
            childLogger().info('info message', data);
            expect(lines[0]).toContain('"leaf":"[Array]"');
        });

        it('should serialize arrays of up to 100 items in full', () => {
            const items = Array.from({ length: 100 }, (_, i) => i);
            childLogger().info('info message', { items });
            expect(loggedData()['items']).toEqual(items);
        });

        it('should mark the 101st array item as not stringified', () => {
            const items = Array.from({ length: 101 }, (_, i) => i);
            childLogger().info('info message', { items });
            expect(loggedData()['items']).toEqual([
                ...items.slice(0, 100),
                '... 1 item not stringified',
            ]);
        });

        it('should count every truncated array item', () => {
            const items = Array.from({ length: 105 }, (_, i) => i);
            childLogger().info('info message', { items });
            expect(lines[0]).toContain('"... 5 items not stringified"');
        });

        it('should serialize objects of up to 100 keys in full', () => {
            const data = Object.fromEntries(
                Array.from({ length: 100 }, (_, i) => [`key${i}`, i]),
            );
            childLogger().info('info message', data);
            expect(loggedData()).toEqual(data);
        });

        it('should mark keys past the 100th as not stringified', () => {
            const data = Object.fromEntries(
                Array.from({ length: 101 }, (_, i) => [`key${i}`, i]),
            );
            childLogger().info('info message', data);
            expect(loggedData()['...']).toBe('1 item not stringified');
            expect(Object.keys(loggedData())).not.toContain('key100');
        });

        it('should log bigint values as strings to keep their precision', () => {
            childLogger().info('info message', { big: 12345678901234567890n });
            expect(loggedData()['big']).toBe('12345678901234567890');
        });

        it('should mark circular references', () => {
            const circular: Record<string, unknown> = { key: 'value' };
            circular['self'] = circular;
            childLogger().info('info message', { circular });
            expect(loggedData()['circular']).toEqual({
                key: 'value',
                self: '[Circular]',
            });
        });

        it('should log an object referenced twice, but not circularly, in full', () => {
            const shared = { key: 'value' };
            childLogger().info('info message', { a: shared, b: shared });
            expect(loggedData()).toEqual({ a: shared, b: shared });
        });

        it('should use toJSON, e.g. for dates', () => {
            const date = new Date('2026-01-01T00:00:00.000Z');
            childLogger().info('info message', { date });
            expect(loggedData()['date']).toBe('2026-01-01T00:00:00.000Z');
        });

        it('should keep a key named __proto__ as data', () => {
            const data = JSON.parse('{"__proto__":{"key":"value"}}') as Record<
                string,
                unknown
            >;
            childLogger().info('info message', data);
            expect(lines[0]).toContain('"data":{"__proto__":{"key":"value"}}');
        });

        it('should log unserializable data as a marker instead of throwing', () => {
            const data = {
                get key() {
                    throw new Error('getter failed');
                },
            };
            expect(() => {
                childLogger().info('info message', data);
            }).not.toThrow();
            expect(loggedData()).toBe('[Unserializable]');
        });
    });
});
