import { transports, createLogger, format } from 'winston';
import { configure } from 'safe-stable-stringify';
import {
    ChildLogger,
    LoggerLevel,
    LoggerOptions,
    RootLogger,
    Data,
} from './logger.types';
import { hostname } from 'os';
import { contextFormat } from './context';

export { configureContext } from './context';

const { timestamp, combine } = format;

const MESSAGE = Symbol.for('message');

/**
 * Resolved once rather than per entry: `os.hostname()` is a syscall (~450ns), a
 * meaningful slice of the cost of emitting a log line.
 */
const PID = process.pid;
const HOSTNAME = hostname();

/**
 * Without caps, logging a Koa context or an axios error turns one log call into
 * megabytes of blocking `JSON.stringify` on the request path. Truncation is marked in
 * the output rather than silent.
 *
 * Key sorting is off: logs are machine-consumed, and sorting costs a sort per object
 * per entry.
 *
 * Serialized here rather than with winston's `json()`, which bundles
 * safe-stable-stringify 2: it silently drops the 101st array item and under-counts
 * truncated items by one. Version 3 fixes both.
 */
const stringify = configure({
    deterministic: false,
    maximumDepth: 10,
    maximumBreadth: 100,
    circularValue: '[Circular]',
});

/** Quoted so a bigint keeps its precision when the line is parsed back. */
function bigintAsString(_key: string, value: unknown): unknown {
    return typeof value === 'bigint' ? value.toString() : value;
}

const jsonFormat = format((info) => {
    info[MESSAGE] = stringify(info, bigintAsString);
    return info;
});

/**
 * Create the service-wide root logger. Call once at startup, then create a child logger
 * per module and action.
 *
 * @param serviceName - Added to every entry as `service`.
 * @param options - Minimum level and extra transports.
 *
 * @example
 * ```ts
 * import { logger } from '@jtkunley/logger';
 *
 * const rootLogger = logger.init('my-service', { level: 'debug' });
 * const log = rootLogger.child('userController', 'create');
 * log.info('User created', { userId });
 * ```
 */
export function init(
    serviceName: string,
    options: LoggerOptions = {},
): RootLogger {
    const rootLogger = createLogger({
        level: options.level ?? 'info',
        format: combine(timestamp(), contextFormat(), jsonFormat()),
        defaultMeta: {
            service: serviceName,
            pid: PID,
            hostname: HOSTNAME,
        },
        transports: [
            new transports.Console(),
            ...Object.values(options.customTransports ?? {}),
        ],
    });
    return {
        level: (level: LoggerLevel) => {
            rootLogger.level = level;
        },
        child: (module: string, action: string): ChildLogger => {
            const logger = rootLogger.child({ module, action });
            return {
                debug: (message: string, data: Data): void => {
                    if (logger.isLevelEnabled('debug')) {
                        logger.debug({ message, data });
                    }
                },
                info: (message: string, data: Data): void => {
                    if (logger.isLevelEnabled('info')) {
                        logger.info({ message, data });
                    }
                },
                warn: (message: string, data: Data): void => {
                    if (logger.isLevelEnabled('warn')) {
                        logger.warn({ message, data });
                    }
                },
                error: (message: string, error: unknown, data: Data): void => {
                    logger.error({
                        message,
                        data,
                        ...(error instanceof Error
                            ? { error: error.message, stack: error.stack }
                            : { error }),
                    });
                },
            };
        },
    };
}
