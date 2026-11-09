/** The severities a logger accepts, from most to least verbose. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** The structured payload of an entry, logged under `data`. */
export type LogData = Record<string, unknown>;

/**
 * Fields added to the top level of every entry. A function is a synchronous,
 * zero-argument resolver, called for each emitted entry; one that throws or
 * returns `undefined` leaves its field out. Values are bounded like `data`.
 * `undefined` removes a key configured earlier. The keys `level`, `time`, `pid`,
 * `hostname`, `service`, `module`, `action`, `msg`, `data` and `err` are ignored.
 */
export type LogContext = Record<string, unknown>;

/** An extra output, beside stdout, run by Pino's worker transport. */
export interface TransportOptions {
    /** A Pino transport target, such as `pino/file` or a package name. */
    target: string;
    /** Passed to the target as they are. */
    options?: Record<string, unknown>;
    /** Default `debug`: the target receives every entry the root emits. */
    level?: LogLevel;
}

export interface LoggerOptions {
    /** Default `info`. */
    level?: LogLevel;
    /** Outputs in addition to stdout. */
    transports?: TransportOptions[];
}

/** Writes entries tagged with a module and action. */
export interface ChildLogger {
    debug(message: string, data: LogData): void;
    info(message: string, data: LogData): void;
    warn(message: string, data: LogData): void;
    /** `error` takes whatever was caught; `undefined` omits `err`. */
    error(message: string, error: unknown, data: LogData): void;
}

/**
 * One service's logger, with its own level and outputs. Stdout and every
 * transport share one worker thread, so a failing target affects them all.
 */
export interface RootLogger {
    child(module: string, action: string): ChildLogger;
    /** Changes the minimum level, for existing children too. */
    level(level: LogLevel): void;
    /**
     * Resolves once the outputs have flushed, after 10 seconds without an
     * answer, or at once if the transport has failed. It never rejects.
     */
    flush(): Promise<void>;
}
