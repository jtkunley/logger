import { configureContext } from './lib/context';
import { init } from './lib/logger';

export { configureContext, init };

/** Both functions under one name, for `import { logger } from '@jtkunley/logger'`. */
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
