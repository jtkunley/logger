import { vi } from 'vitest';
import { transports } from 'winston';
import Transport from 'winston-transport';

import { configureContext, init } from '../logger';
import { _resetContextForTesting } from '../context';

vi.mock('winston', async () => {
    const winston = await vi.importActual('winston');
    return winston;
});

const mockLog = vi.fn();

const MESSAGE = Symbol.for('message');

function serializedLine(): string {
    const [info] = mockLog.mock.calls[0] as [Record<symbol, string>];
    return info[MESSAGE];
}

function childLogger(level?: 'debug' | 'info') {
    return init('SampleServiceName', { level }).child(
        'someService',
        'someAction',
    );
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

    it.each(['debug', 'info', 'warn'] as const)('should log %s', (level) => {
        childLogger('debug')[level](`${level} message`, { key: 'value' });
        expect(mockLog).toHaveBeenCalledWith(
            expect.objectContaining({
                ...baseEntry,
                level,
                message: `${level} message`,
                data: { key: 'value' },
            }),
            expect.anything(),
        );
    });

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

    it('should respect log level', () => {
        childLogger('info').debug('debug message', { key: 'value' });
        expect(mockLog).not.toHaveBeenCalled();
    });

    it('should dynamically update the log level', () => {
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
        const customLog = vi.fn((_info: unknown, next: () => void) => next());
        class CustomTransport extends Transport {
            override log(info: unknown, next: () => void) {
                customLog(info, next);
            }
        }
        const rootLogger = init('SampleServiceName', {
            customTransports: { custom: new CustomTransport() },
        });
        const logger = rootLogger.child('someService', 'someAction');

        rootLogger.level('error');
        logger.info('info message', { key: 'value' });
        expect(customLog).not.toHaveBeenCalled();
        expect(mockLog).not.toHaveBeenCalled();

        logger.error('error message', new Error('oops'), {});
        expect(customLog).toHaveBeenCalledTimes(1);
        expect(mockLog).toHaveBeenCalledTimes(1);
    });

    it('should inject configured context into every entry', () => {
        configureContext({
            organizationId: 'org-123',
            correlationId: () => 'corr-456',
        });
        childLogger().info('info message', { key: 'value' });
        expect(mockLog).toHaveBeenCalledWith(
            expect.objectContaining({
                ...baseEntry,
                organizationId: 'org-123',
                correlationId: 'corr-456',
                data: { key: 'value' },
            }),
            expect.anything(),
        );
    });

    it('should not throw when a context resolver throws', () => {
        configureContext({
            organizationId: () => {
                throw new Error('no request context');
            },
        });
        expect(() =>
            childLogger().info('info message', { key: 'value' }),
        ).not.toThrow();
        expect(mockLog).toHaveBeenCalledWith(
            expect.not.objectContaining({ organizationId: expect.anything() }),
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

    it('should cap deeply nested data rather than serializing without bound', () => {
        let nested: Record<string, unknown> = { leaf: 'bottom' };
        for (let i = 0; i < 15; i++) {
            nested = { [`level${i}`]: nested };
        }
        childLogger().info('info message', { nested });
        const line = serializedLine();
        expect(line).toContain('"[Object]"');
        expect(line).not.toContain('bottom');
    });

    it('should cap wide collections in data rather than serializing without bound', () => {
        childLogger().info('info message', {
            wide: Array.from({ length: 105 }, (_, i) => i),
        });
        expect(serializedLine()).toContain('items not stringified');
    });
});
