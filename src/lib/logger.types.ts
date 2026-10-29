/**
 * Log severity, from most to least severe. Setting a level emits that level and
 * everything more severe: `'warn'` emits `warn` and `error`.
 */
export type LoggerLevel = 'error' | 'warn' | 'info' | 'debug';

/**
 * A pino transport to send entries to, in addition to stdout. It runs in the logging
 * worker thread, so its I/O never blocks the main thread.
 *
 * Any pino transport works: a package name, or an absolute path to your own module.
 */
export interface TransportTarget {
    /** Module that builds the transport, e.g. `'pino/file'` or `'pino-loki'`. */
    target: string;
    /** Passed to the transport. Must be serializable, since it crosses into the worker thread. */
    options?: Record<string, unknown>;
    /**
     * Minimum severity for this transport. It can only narrow the root logger's level,
     * never widen it. Without it, the transport follows the root logger's level,
     * including runtime changes.
     */
    level?: LoggerLevel;
}

/** Options for `init`. */
export interface LoggerOptions {
    /**
     * Minimum severity to emit.
     * @defaultValue `'info'`
     */
    level?: LoggerLevel;
    /**
     * Extra destinations. Stdout is always one.
     *
     * @example
     * ```ts
     * init('my-service', {
     *     transports: [
     *         { target: 'pino/file', options: { destination: '/var/log/app.log' } },
     *     ],
     * });
     * ```
     */
    transports?: TransportTarget[];
}

/**
 * A function invoked on every log entry; its return value is logged. Returning
 * `undefined` or throwing omits the field from that entry.
 */
export type ContextResolver = () => unknown;

/**
 * Name/value pairs added at the root of every log entry. See `configureContext`.
 *
 * A function value is a {@link ContextResolver}; any other value is logged as-is. A
 * value of `undefined` is omitted.
 *
 * @example
 * ```ts
 * const context: Context = {
 *     'x-context-id-1': 'x-context-value-1',
 *     'x-context-id-2': () => requestStore.getStore()?.contextValue,
 * };
 * ```
 */
export type Context = Record<string, unknown>;

/**
 * Arbitrary structured data attached to a log entry under the `data` field.
 * Serialization is capped at 10 levels deep and 100 keys or array items per object.
 */
export type Data = Record<string, unknown>;

/**
 * The service-wide logger returned by `init`. Log through child loggers created
 * with {@link RootLogger.child}.
 */
export interface RootLogger {
    /**
     * Create a logger for one logical action within a module. Every entry it writes
     * includes `module` and `action`.
     *
     * @param module - The code module, e.g. `'userController'`.
     * @param action - The operation within the module, e.g. `'create'`.
     *
     * @example
     * ```ts
     * const log = rootLogger.child('userController', 'create');
     * log.info('User created', { userId });
     * ```
     */
    child(module: string, action: string): ChildLogger;
    /**
     * Change the minimum severity at runtime, without a restart. Applies to every
     * child logger, including ones already created.
     *
     * @example
     * ```ts
     * flags.on('change:log-level', (level) => rootLogger.level(level));
     * ```
     */
    level(level: LoggerLevel): void;
    /**
     * Wait until every entry logged so far has been written. Call it before exiting
     * deliberately, e.g. in a shutdown or fatal-error handler; entries still buffered
     * when a process is killed are lost. Never rejects, and gives up after 10 seconds so
     * a stuck transport can't hang shutdown.
     *
     * @example
     * ```ts
     * process.on('SIGTERM', async () => {
     *     await server.close();
     *     await rootLogger.flush();
     *     process.exit(0);
     * });
     * ```
     */
    flush(): Promise<void>;
}

/**
 * Writes structured JSON log entries, one per line, in pino's format. Every entry
 * includes `level` (pino's number: 20 debug, 30 info, 40 warn, 50 error), `time`
 * (epoch milliseconds), `service`, `pid`, `hostname`, `module`, `action`, `msg`,
 * `data`, and any configured {@link Context}.
 */
export interface ChildLogger {
    /** Log verbose diagnostic detail, usually off in production. */
    debug(message: string, data: Data): void;
    /** Log a normal, noteworthy event. */
    info(message: string, data: Data): void;
    /** Log something unexpected that didn't stop the operation. */
    warn(message: string, data: Data): void;
    /**
     * Log a failure, with the caught value under `err`. An `Error` is logged as
     * `{ type, message, stack }` plus any extra properties, with its `cause` chain
     * appended to `message` and `stack`. Any other thrown value is logged as-is.
     *
     * @example
     * ```ts
     * try {
     *     await createUser(input);
     * } catch (err) {
     *     log.error('Failed to create user', err, { userId });
     * }
     * ```
     */
    error(message: string, error: unknown, data: Data): void;
}
