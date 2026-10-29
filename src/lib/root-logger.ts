import { hostname } from 'node:os';
import { pino } from 'pino';
import { resolveContext } from './context';
import type { Destination } from './destination';
import type {
    ChildLogger,
    Data,
    LoggerLevel,
    RootLogger,
} from './logger.types';
import { bound } from './serialize';

/**
 * Resolved once rather than per entry: `os.hostname()` is a syscall (~450ns), a
 * meaningful slice of the cost of emitting a log line.
 */
const HOSTNAME = hostname();

/** Matches pino's own cap on flushing at exit, so a stuck transport can't hang shutdown. */
const FLUSH_TIMEOUT_MS = 10_000;

export function createRootLogger(
    serviceName: string,
    level: LoggerLevel,
    destination: Destination,
): RootLogger {
    const rootLogger = pino(
        {
            level,
            base: {
                service: serviceName,
                pid: process.pid,
                hostname: HOSTNAME,
            },
            mixin: resolveContext,
            serializers: {
                err: (error: Error) => bound(pino.stdSerializers.err(error)),
            },
        },
        destination,
    );
    return {
        level: (newLevel: LoggerLevel) => {
            rootLogger.level = newLevel;
        },
        flush: () =>
            new Promise<void>((resolve) => {
                // The pending timer also keeps the process alive until the flush completes.
                const timeout = setTimeout(resolve, FLUSH_TIMEOUT_MS);
                rootLogger.flush(() => {
                    clearTimeout(timeout);
                    resolve();
                });
            }),
        child: (module: string, action: string): ChildLogger => {
            const logger = rootLogger.child({ module, action });
            return {
                debug: (message: string, data: Data): void => {
                    if (logger.isLevelEnabled('debug')) {
                        logger.debug({ data: bound(data) }, message);
                    }
                },
                info: (message: string, data: Data): void => {
                    if (logger.isLevelEnabled('info')) {
                        logger.info({ data: bound(data) }, message);
                    }
                },
                warn: (message: string, data: Data): void => {
                    if (logger.isLevelEnabled('warn')) {
                        logger.warn({ data: bound(data) }, message);
                    }
                },
                error: (message: string, error: unknown, data: Data): void => {
                    logger.error({ err: error, data: bound(data) }, message);
                },
            };
        },
    };
}
