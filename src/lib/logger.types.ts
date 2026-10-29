import { Logger, transport } from 'winston';

/**
 * Log severity, from most to least severe. Setting a level emits that level and
 * everything more severe: `'warn'` emits `warn` and `error`.
 */
export type LoggerLevel = 'error' | 'warn' | 'info' | 'debug';

/** Options for `init`. */
export interface LoggerOptions {
    /**
     * Minimum severity to emit.
     * @defaultValue `'info'`
     */
    level?: LoggerLevel;
    /**
     * Extra winston transports to write to, in addition to the console. Keys are
     * labels for your own reference.
     *
     * A transport without its own `level` follows the root logger's level, so runtime
     * level changes apply to it too.
     *
     * @example
     * ```ts
     * init('VisitService', {
     *     customTransports: { file: new transports.File({ filename: 'app.log' }) },
     * });
     * ```
     */
    customTransports?: Record<string, transport>;
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
 *     tier: process.env.TIER,
 *     correlationId: () => requestStore.getStore()?.correlationId,
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
     * @param module - The code module, e.g. `'paymentController'`.
     * @param action - The operation within the module, e.g. `'charge'`.
     *
     * @example
     * ```ts
     * const log = rootLogger.child('paymentController', 'charge');
     * log.info('Payment charged', { paymentId });
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
}

/**
 * Writes structured JSON log entries. Every entry includes `service`, `module`,
 * `action`, `level`, `message`, `timestamp`, `pid`, `hostname`, `data`, and any
 * configured {@link Context}.
 */
export interface ChildLogger {
    /** Log verbose diagnostic detail, usually off in production. */
    debug(message: string, data: Data): void;
    /** Log a normal, noteworthy event. */
    info(message: string, data: Data): void;
    /** Log something unexpected that didn't stop the operation. */
    warn(message: string, data: Data): void;
    /**
     * Log a failure. For an `Error`, its message and stack are added at the root of the
     * entry as `error` and `stack`; any other thrown value is logged as `error` as-is.
     *
     * @example
     * ```ts
     * try {
     *     await charge(payment);
     * } catch (err) {
     *     log.error('Failed to charge payment', err, { paymentId });
     * }
     * ```
     */
    error(message: string, error: unknown, data: Data): void;
    /**
     * Escape hatch to the underlying winston logger, for features this wrapper doesn't
     * expose. Entries written through it still get context and respect the configured level.
     */
    getVendorInstance(): Logger;
}
