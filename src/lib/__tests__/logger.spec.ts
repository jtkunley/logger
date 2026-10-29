import { vi } from 'vitest';
import { transports } from 'winston';
import Transport from 'winston-transport';

import { configureContext, init } from '../logger';
import { _resetContextForTesting } from '../context';
import type { LoggerLevel } from '../logger.types';

vi.mock('winston', async () => {
    const winston = await vi.importActual('winston');
    return winston;
});

const mockLog = vi.fn((_info: unknown, next: () => void) => {
    next();
});

const MESSAGE = Symbol.for('message');

const LEVELS = ['error', 'warn', 'info', 'debug'] as const;

type LoggedInfo = Record<string, unknown> & Record<symbol, string>;

function loggedEntries(): LoggedInfo[] {
    return mockLog.mock.calls.map(([info]) => info as LoggedInfo);
}

function serializedLine(): string {
    const info = loggedEntries().at(0);
    if (!info) throw new Error('nothing was logged');
    return info[MESSAGE];
}

function loggedData(): Record<string, unknown> {
    return (JSON.parse(serializedLine()) as { data: Record<string, unknown> })
        .data;
}

function childLogger(level?: LoggerLevel) {
    return init('SampleServiceName', { level }).child(
        'someService',
        'someAction',
    );
}

function logAtEveryLevel(logger: ReturnType<typeof childLogger>) {
    logger.debug('debug message', {});
    logger.info('info message', {});
    logger.warn('warn message', {});
    logger.error('error message', new Error('oops'), {});
}

function recordingTransport(options?: { level: LoggerLevel }) {
    const log = vi.fn();
    class RecordingTransport extends Transport {
        override log(info: unknown, next: () => void) {
            log(info);
            next();
        }
    }
    return { transport: new RecordingTransport(options), log };
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
    pid: expect.any(Number),
    timestamp: expect.any(String),
};

describe('RootLogger', () => {
    beforeEach(() => {
        transports.Console.prototype.log = mockLog;
    });
    afterEach(() => {
        vi.resetAllMocks();
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
            expect(loggedEntries().map((info) => info['level'])).toEqual(
                expected,
            );
        });

        it('should default to info', () => {
            logAtEveryLevel(childLogger());
            expect(loggedEntries().map((info) => info['level'])).toEqual([
                'info',
                'warn',
                'error',
            ]);
        });

        it('should dynamically update the log level of existing child loggers', () => {
            const rootLogger = init('SampleServiceName', { level: 'info' });
            const logger = rootLogger.child('someService', 'someAction');
            logger.debug('debug before level change', { key: 'value' });
            expect(mockLog).not.toHaveBeenCalled();

            rootLogger.level('debug');
            logger.debug('debug after level change', { key: 'value' });
            expect(mockLog).toHaveBeenCalledWith(
                expect.objectContaining({
                    level: 'debug',
                    message: 'debug after level change',
                }),
                expect.anything(),
            );
        });

        it('should apply level changes to custom transports without their own level', () => {
            const custom = recordingTransport();
            const rootLogger = init('SampleServiceName', {
                customTransports: { custom: custom.transport },
            });
            const logger = rootLogger.child('someService', 'someAction');

            rootLogger.level('error');
            logger.info('info message', { key: 'value' });
            expect(custom.log).not.toHaveBeenCalled();
            expect(mockLog).not.toHaveBeenCalled();

            logger.error('error message', new Error('oops'), {});
            expect(custom.log).toHaveBeenCalledTimes(1);
            expect(mockLog).toHaveBeenCalledTimes(1);
        });

        it('should leave custom transports with their own level at that level', () => {
            const custom = recordingTransport({ level: 'warn' });
            const rootLogger = init('SampleServiceName', {
                level: 'debug',
                customTransports: { custom: custom.transport },
            });
            const logger = rootLogger.child('someService', 'someAction');

            logger.info('info message', {});
            expect(mockLog).toHaveBeenCalledTimes(1);
            expect(custom.log).not.toHaveBeenCalled();

            rootLogger.level('error');
            logger.warn('warn message', {});
            expect(mockLog).toHaveBeenCalledTimes(1);
            expect(custom.log).toHaveBeenCalledTimes(1);
        });
    });

    describe('entries', () => {
        it.each(['debug', 'info', 'warn'] as const)(
            'should log %s with the standard fields',
            (level) => {
                childLogger('debug')[level](`${level} message`, {
                    key: 'value',
                });
                expect(mockLog).toHaveBeenCalledWith(
                    expect.objectContaining({
                        ...baseEntry,
                        level,
                        message: `${level} message`,
                        data: { key: 'value' },
                    }),
                    expect.anything(),
                );
            },
        );

        it('should log error with the error message and stack at the top level', () => {
            childLogger().error('error message', new Error('oops'), {
                key: 'value',
            });
            expect(mockLog).toHaveBeenCalledWith(
                expect.objectContaining({
                    ...baseEntry,
                    level: 'error',
                    message: 'error message',
                    data: { key: 'value' },
                    error: 'oops',
                    stack: expect.stringContaining('Error: oops'),
                }),
                expect.anything(),
            );
        });

        it('should log a thrown non-Error value as-is', () => {
            childLogger().error('error message', 'plain string', {});
            expect(mockLog).toHaveBeenCalledWith(
                expect.objectContaining({ error: 'plain string' }),
                expect.anything(),
            );
            expect(mockLog).toHaveBeenCalledWith(
                expect.not.objectContaining({ stack: expect.anything() }),
                expect.anything(),
            );
        });

        it('should emit a parseable json line including pid and hostname', () => {
            childLogger().info('info message', { key: 'value' });
            expect(JSON.parse(serializedLine())).toEqual(
                expect.objectContaining({
                    level: 'info',
                    message: 'info message',
                    data: { key: 'value' },
                    service: 'SampleServiceName',
                    pid: expect.any(Number),
                    hostname: expect.any(String),
                }),
            );
        });
    });

    describe('context', () => {
        it('should inject configured context into every entry', () => {
            configureContext({
                'x-context-id-1': 'x-context-value-1',
                'x-context-id-2': () => 'x-context-value-2',
            });
            childLogger().info('info message', { key: 'value' });
            expect(mockLog).toHaveBeenCalledWith(
                expect.objectContaining({
                    ...baseEntry,
                    'x-context-id-1': 'x-context-value-1',
                    'x-context-id-2': 'x-context-value-2',
                    data: { key: 'value' },
                }),
                expect.anything(),
            );
        });

        it('should inject context at every level', () => {
            configureContext({ 'x-context-id-1': 'x-context-value-1' });
            logAtEveryLevel(childLogger('debug'));
            expect(loggedEntries()).toHaveLength(LEVELS.length);
            for (const info of loggedEntries()) {
                expect(info['x-context-id-1']).toBe('x-context-value-1');
            }
        });

        it('should apply context configured after the logger was created', () => {
            const logger = childLogger();
            configureContext({ 'x-context-id-1': 'x-context-value-1' });
            logger.info('info message', {});
            expect(mockLog).toHaveBeenCalledWith(
                expect.objectContaining({
                    'x-context-id-1': 'x-context-value-1',
                }),
                expect.anything(),
            );
        });

        it('should never overwrite built-in fields', () => {
            configureContext({
                service: 'x-context-value-1',
                module: 'x-context-value-1',
                action: 'x-context-value-1',
                pid: 'x-context-value-1',
                hostname: 'x-context-value-1',
                timestamp: 'x-context-value-1',
                level: 'x-context-value-1',
                message: 'x-context-value-1',
                data: 'x-context-value-1',
            });
            childLogger().info('info message', { key: 'value' });
            expect(mockLog).toHaveBeenCalledWith(
                expect.objectContaining({
                    ...baseEntry,
                    level: 'info',
                    message: 'info message',
                    data: { key: 'value' },
                }),
                expect.anything(),
            );
        });

        it('should not invoke resolvers for entries below the level', () => {
            const resolver = vi.fn(() => 'x-context-value-1');
            configureContext({ 'x-context-id-1': resolver });
            childLogger('info').debug('debug message', {});
            expect(resolver).not.toHaveBeenCalled();
        });

        it('should not throw when a context resolver throws', () => {
            configureContext({
                'x-context-id-1': () => {
                    throw new Error('no request context');
                },
            });
            expect(() => {
                childLogger().info('info message', { key: 'value' });
            }).not.toThrow();
            expect(mockLog).toHaveBeenCalledWith(
                expect.not.objectContaining({
                    'x-context-id-1': expect.anything(),
                }),
                expect.anything(),
            );
        });
    });

    describe('serialization limits', () => {
        it('should serialize data up to 8 levels deep in full', () => {
            childLogger().info('info message', nested(8));
            expect(serializedLine()).toContain('"bottom"');
            expect(serializedLine()).not.toContain('"[Object]"');
        });

        it('should mark data nested 9 levels deep as truncated', () => {
            childLogger().info('info message', nested(9));
            expect(serializedLine()).toContain('"[Object]"');
            expect(serializedLine()).not.toContain('"bottom"');
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
            expect(serializedLine()).toContain('"... 5 items not stringified"');
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
            expect(serializedLine()).toContain('1 item not stringified');
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
    });
});
