import type { EventEmitter } from 'node:events';
import { transport } from 'pino';
import type { TransportTarget } from './logger.types';

/** Where serialized lines go. `flush` calls back once every written line is out. */
export interface Destination {
    write(line: string): unknown;
    flush(callback: () => void): void;
}

/** The parts of pino's worker-thread stream this library relies on. */
export interface TransportStream extends EventEmitter {
    readonly destroyed: boolean;
    write(line: string): boolean;
    flush(callback: (err?: Error | null) => void): void;
}

/**
 * Writes run in a worker thread, so I/O never blocks the main thread. Stdout is always
 * a target: a log collector reading it keeps every line the process managed to write,
 * even if the process later crashes.
 *
 * Targets default to the lowest level so the root logger's level, which can change at
 * runtime, is the only filter.
 */
export function createDestination(
    serviceName: string,
    targets: TransportTarget[],
): Destination {
    // thread-stream's type definitions omit its `destroyed` getter.
    const stream = transport({
        targets: [
            { target: 'pino/file', options: { destination: 1 } },
            ...targets,
        ].map((target) => ({ ...target, level: target.level ?? 'debug' })),
    }) as unknown as TransportStream;
    return withFallback(stream, process.stderr, serviceName);
}

/**
 * If the worker dies, later writes would be lost and the unhandled `error` event would
 * crash the process. Logs go to `fallback` instead, after one entry saying why.
 */
export function withFallback(
    stream: TransportStream,
    fallback: { write(line: string): unknown },
    serviceName: string,
): Destination {
    let warned = false;
    stream.on('error', (err: Error) => {
        if (warned) return;
        warned = true;
        fallback.write(
            `${JSON.stringify({
                level: 50,
                time: Date.now(),
                service: serviceName,
                msg: 'Log transport failed; writing logs to stderr',
                err: { type: err.name, message: err.message, stack: err.stack },
            })}\n`,
        );
    });
    return {
        write: (line) =>
            stream.destroyed ? fallback.write(line) : stream.write(line),
        flush: (callback) => {
            if (stream.destroyed) {
                callback();
            } else {
                stream.flush(() => {
                    callback();
                });
            }
        },
    };
}
