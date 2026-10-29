import { createDestination } from './destination';
import type { LoggerOptions, RootLogger } from './logger.types';
import { createRootLogger } from './root-logger';

export { configureContext } from './context';

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
    return createRootLogger(
        serviceName,
        options.level ?? 'info',
        createDestination(serviceName, options.transports ?? []),
    );
}
