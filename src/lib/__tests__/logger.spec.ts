import { vi } from 'vitest';
import { transports } from 'winston';

import { init } from '../logger';

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
