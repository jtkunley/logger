import { transports, createLogger, format } from 'winston';
import {
    ChildLogger,
    LoggerLevel,
    LoggerOptions,
    RootLogger,
    Data,
} from './logger.types';
import { hostname } from 'os';

const { timestamp, combine, json } = format;

/**
 * Resolved once rather than per entry: `os.hostname()` is a syscall (~450ns), a
 * meaningful slice of the cost of emitting a log line.
 */
const PID = process.pid;
const HOSTNAME = hostname();

export function init(
    serviceName: string,
    options: LoggerOptions = {},
): RootLogger {
    const rootLogger = createLogger({
        level: options.level ?? 'info',
        format: combine(timestamp(), json()),
        defaultMeta: {
            service: serviceName,
            pid: PID,
            hostname: HOSTNAME,
        },
        transports: [new transports.Console()],
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
                error: (message: string, error: Error, data: Data): void => {
                    if (logger.isLevelEnabled('error')) {
                        logger.error({
                            message,
                            data,
                            error: error?.message,
                            stack: error?.stack,
                        });
                    }
                },
            };
        },
    };
}
