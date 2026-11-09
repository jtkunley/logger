import { createRequire } from 'module';
import { hostname } from 'os';
import { isAbsolute, join } from 'path';
import pino from 'pino';
import { boundValue, UNSERIALIZABLE } from './bound';
import { resolveContext } from './context';
import type { ChildLogger, LogData, LoggerOptions, LogLevel, RootLogger } from './types';
import type { WorkerOptions, WorkerTarget } from './worker';

/** `pino.transport` returns a thread-stream, whose `destroyed` getter is untyped. */
type TransportStream = ReturnType<typeof pino.transport> & { readonly destroyed: boolean };

/** The compiled worker, beside this file in the published package. */
const WORKER = join(__dirname, 'worker.js');
const STDOUT = 1;
/** Pino's numeric levels, as written in each entry's `level` field. */
const LEVELS: Record<LogLevel, number> = { debug: 20, info: 30, warn: 40, error: 50 };
const FLUSH_TIMEOUT_MS = 10_000;
const TRANSPORT_FAILED = 'Log transport failed; writing logs to stderr';

/**
 * Pino's error serializer, then bounding. The serializer reads every enumerable
 * property and tags the error, so a throwing getter or a frozen error would
 * otherwise throw into the caller's `catch` block.
 */
function serializeError(error: unknown): unknown {
    try {
        return boundValue(pino.stdSerializers.err(error as Error));
    } catch {
        return UNSERIALIZABLE;
    }
}

/**
 * Resolves a target the way Pino does, from this package, then from the
 * application's working directory, where a package manager that doesn't hoist
 * keeps the application's own transports.
 */
export function resolveTarget(target: string): string {
    if (isAbsolute(target) || target.startsWith('file://')) {
        return target;
    }
    for (const from of [__filename, join(process.cwd(), 'noop.js')]) {
        try {
            return createRequire(from).resolve(target);
        } catch {
            continue;
        }
    }
    throw new Error(`Unable to resolve transport target "${target}"`);
}

/** Starts the worker with stdout and the configured transports as its outputs. */
function startTransport(transports: LoggerOptions['transports'] = []): TransportStream {
    const targets: WorkerTarget[] = [
        {
            target: resolveTarget('pino/file'),
            options: { destination: STDOUT },
            level: LEVELS.debug,
        },
        ...transports.map(({ target, options = {}, level = 'debug' }) => ({
            target: resolveTarget(target),
            options,
            level: LEVELS[level],
        })),
    ];
    return pino.transport({
        target: WORKER,
        options: { targets } satisfies WorkerOptions,
    }) as TransportStream;
}

/** Writes one diagnostic line to stderr for the first transport error, and ignores the rest. */
function reportFirstError(transport: TransportStream, service: string): void {
    let reported = false;
    transport.on('error', (error: unknown) => {
        if (reported) {
            return;
        }
        reported = true;
        const err = pino.stdSerializers.err(
            error instanceof Error ? error : new Error(String(error)),
        );
        const diagnostic = {
            level: LEVELS.error,
            time: Date.now(),
            service,
            msg: TRANSPORT_FAILED,
            err: { type: err.type, message: err.message, stack: err.stack },
        };
        process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
    });
}

/**
 * Where Pino writes each line: the transport, or stderr once it is destroyed.
 * Routed on `destroyed`, not on the error event: thread-stream can emit an
 * error and keep working, but a destroyed stream drops every write.
 */
function fallbackDestination(transport: TransportStream): { write(line: string): boolean } {
    return {
        write(line: string): boolean {
            return transport.destroyed ? process.stderr.write(line) : transport.write(line);
        },
    };
}

/** Flushes the transport, resolving at once if it is destroyed and after the timeout at the latest. */
function flushWithTimeout(transport: TransportStream): Promise<void> {
    if (transport.destroyed) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, FLUSH_TIMEOUT_MS);
        transport.flush(() => {
            clearTimeout(timer);
            resolve();
        });
    });
}

/**
 * Creates a root logger for a service, writing JSON lines to stdout and any
 * configured transports from a worker thread.
 */
export function init(service: string, options: LoggerOptions = {}): RootLogger {
    const transport = startTransport(options.transports);
    reportFirstError(transport, service);

    const instance = pino(
        {
            level: options.level ?? 'info',
            base: { service, pid: process.pid, hostname: hostname() },
            serializers: {
                data: boundValue,
                err: serializeError,
            },
        },
        fallbackDestination(transport),
    );

    function log(
        level: LogLevel,
        module: string,
        action: string,
        message: string,
        data: LogData,
        error?: unknown,
    ): void {
        // Checked before anything is built, so suppressed entries never read data or run resolvers.
        if (!instance.isLevelEnabled(level)) {
            return;
        }
        instance[level]({ module, action, ...resolveContext(), data, err: error }, message);
    }

    return {
        child(module: string, action: string): ChildLogger {
            return {
                debug: (message, data) => log('debug', module, action, message, data),
                info: (message, data) => log('info', module, action, message, data),
                warn: (message, data) => log('warn', module, action, message, data),
                error: (message, error, data) => log('error', module, action, message, data, error),
            };
        },
        level(level: LogLevel): void {
            instance.level = level;
        },
        flush: () => flushWithTimeout(transport),
    };
}
