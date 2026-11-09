import { EventEmitter, once } from 'events';
import { Writable } from 'stream';
import { pathToFileURL } from 'url';

/** One output, with its target already resolved to an absolute path or file URL. */
export interface WorkerTarget {
    target: string;
    options: Record<string, unknown>;
    /** The minimum numeric level the output receives. */
    level: number;
}

export interface WorkerOptions {
    targets: WorkerTarget[];
}

/** The stream a Pino transport target builds; often a SonicBoom. */
export interface TargetStream extends EventEmitter {
    // The stream API, whichever parts the target implements.
    write(line: string): unknown;
    end(): unknown;
    flush?: (callback?: (error?: Error | null) => void) => unknown;
    flushSync?: () => void;
    writableNeedDrain?: boolean;

    // SonicBoom internals, read only to wait for its writes; see `flushStream`.
    minLength?: number;
    _writing?: boolean;

    // Set before each write on targets that read the entry from properties,
    // as Pino's multistream does.
    [METADATA]?: boolean;
    lastLevel?: number;
    lastTime?: unknown;
    lastMsg?: unknown;
    lastObj?: unknown;
}

export interface Output {
    level: number;
    stream: TargetStream;
}

type TargetBuilder = (options: Record<string, unknown>) => TargetStream | Promise<TargetStream>;

/**
 * Marks streams that read the level and entry of each line from properties.
 * Cast because TypeScript only treats `Symbol()` as a `unique symbol`, which a
 * computed key in `TargetStream` requires.
 */
const METADATA: unique symbol = Symbol.for('pino.metadata') as never;
/** Every line comes from this package's Pino logger, which writes `level` first. */
const LEVEL = /^\{"level":(\d+)/;

/**
 * Runs in Pino's worker thread, in place of Pino's own multi-target worker,
 * so that flushing waits for every output to finish writing.
 */
export default async function worker({ targets }: WorkerOptions): Promise<Fanout> {
    const outputs = await Promise.all(
        targets.map(async ({ target, options, level }) => {
            const build = await loadTarget(target);
            return { level, stream: await build(options) };
        }),
    );
    return new Fanout(outputs);
}

/** Loads a target module and returns the function that builds its stream. */
export async function loadTarget(target: string): Promise<TargetBuilder> {
    const url = target.startsWith('file://') ? target : pathToFileURL(target).href;
    let loaded = ((await import(url)) as { default?: unknown }).default;
    // A default export transpiled to CommonJS nests the function one level deeper.
    if (typeof loaded === 'object' && loaded !== null) {
        loaded = (loaded as { default?: unknown }).default;
    }
    if (typeof loaded !== 'function') {
        throw new Error(`Transport target "${target}" does not export a function`);
    }
    return loaded as TargetBuilder;
}

/**
 * Splits what the logger writes into lines and writes each one, synchronously,
 * to every output whose level it meets. By the time thread-stream sees a write
 * return, its lines have reached the outputs, so `flush` only has to wait for
 * the outputs themselves.
 */
export class Fanout extends Writable {
    private partial = '';

    constructor(private readonly outputs: Output[]) {
        super({ decodeStrings: false });
    }

    override _write(
        chunk: string,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void,
    ): void {
        const lines = (this.partial + chunk).split('\n');
        this.partial = lines.pop() as string;
        for (const line of lines) {
            this.dispatch(line);
        }
        callback();
    }

    override _final(callback: (error?: Error | null) => void): void {
        this.dispatch(this.partial);
        this.partial = '';
        Promise.all(
            this.outputs.map(({ stream }) => {
                const closed = once(stream, 'close');
                stream.end();
                return closed;
            }),
        ).then(() => callback(), callback);
    }

    /** Called by thread-stream when the logger flushes. */
    flush(callback: (error?: Error | null) => void): void {
        Promise.all(this.outputs.map(({ stream }) => flushStream(stream))).then(
            () => callback(),
            callback,
        );
    }

    private dispatch(line: string): void {
        if (line === '') {
            return;
        }
        // A line without a level is treated as the highest, so it reaches every output.
        const level = Number(LEVEL.exec(line)?.[1] ?? Infinity);
        let entry: Record<string, unknown> | undefined;
        for (const output of this.outputs) {
            if (level < output.level) {
                continue;
            }
            const { stream } = output;
            if (stream[METADATA]) {
                entry ??= JSON.parse(line) as Record<string, unknown>;
                stream.lastLevel = level;
                stream.lastTime = entry['time'];
                stream.lastMsg = entry['msg'];
                stream.lastObj = entry;
            }
            stream.write(`${line}\n`);
        }
    }
}

/**
 * A SonicBoom, as `pino/file` creates, that writes each line straight away.
 * Its `flush` does nothing, so its in-flight write has to be awaited through
 * `drain` instead. One with a `minLength` buffers, and its `flush` works.
 */
function isUnbufferedSonicBoom(stream: TargetStream): boolean {
    return typeof stream._writing === 'boolean' && (stream.minLength ?? 0) <= 0;
}

/** Resolves once a stream has finished the writes it was given. */
export async function flushStream(stream: TargetStream): Promise<void> {
    if (isUnbufferedSonicBoom(stream)) {
        if (stream._writing) {
            await once(stream, 'drain');
        }
        return;
    }
    if (typeof stream.flush === 'function') {
        const flush = stream.flush.bind(stream);
        if (stream.flush.length === 0) {
            await flush();
            return;
        }
        await new Promise<void>((resolve, reject) => {
            flush((error) => (error ? reject(error) : resolve()));
        });
        return;
    }
    if (typeof stream.flushSync === 'function') {
        stream.flushSync();
        return;
    }
    if (stream.writableNeedDrain) {
        await once(stream, 'drain');
    }
}
