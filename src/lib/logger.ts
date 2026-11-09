import { hostname } from 'os';
import pino from 'pino';
import { boundValue, UNSERIALIZABLE } from './bound';
import { resolveContext } from './context';
import type { ChildLogger, LogData, LoggerOptions, LogLevel, RootLogger } from './types';

/** `pino.transport` returns a thread-stream, whose `destroyed` getter is untyped. */
type TransportStream = ReturnType<typeof pino.transport> & { readonly destroyed: boolean };

const STDOUT = 1;
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
 * Creates a root logger for a service, writing JSON lines to stdout and any
 * configured transports through Pino's worker transport.
 */
export function init(service: string, options: LoggerOptions = {}): RootLogger {
    const transport = pino.transport({
        targets: [
            { target: 'pino/file', options: { destination: STDOUT }, level: 'debug' },
            ...(options.transports ?? []).map(({ target, options = {}, level = 'debug' }) => ({
                target,
                options,
                level,
            })),
        ],
    }) as TransportStream;

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
            level: 50,
            time: Date.now(),
            service,
            msg: TRANSPORT_FAILED,
            err: { type: err.type, message: err.message, stack: err.stack },
        };
        process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
    });

    const destination = {
        write(line: string): boolean {
            // Routed on `destroyed`, not on the error event: thread-stream can emit an
            // error and keep working, but a destroyed stream drops every write.
            return transport.destroyed ? process.stderr.write(line) : transport.write(line);
        },
    };

    const instance = pino(
        {
            level: options.level ?? 'info',
            base: { service, pid: process.pid, hostname: hostname() },
            serializers: {
                data: boundValue,
                err: serializeError,
            },
        },
        destination,
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
        flush(): Promise<void> {
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
        },
    };
}
