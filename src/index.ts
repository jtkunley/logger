import { configureContext } from './lib/context';
import { init } from './lib/logger';

export { configureContext, init };

/** `logger.init(service, options)` and `logger.configureContext(context)`. */
export const logger = { init, configureContext };

export type {
    ChildLogger,
    LogContext,
    LogData,
    LoggerOptions,
    LogLevel,
    RootLogger,
    TransportOptions,
} from './lib/types';
