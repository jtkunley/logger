import { EventEmitter, once } from 'events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { Fanout, flushStream, loadTarget, type TargetStream } from '../worker';

const PINO_FILE = require.resolve('pino/file');

/** Records each line written to it; `end` closes it on the next turn. */
class FakeStream extends EventEmitter {
    readonly lines: string[] = [];
    readonly write = vi.fn((line: string) => {
        this.lines.push(line);
        return true;
    });
    readonly end = vi.fn(() => {
        setImmediate(() => this.emit('close'));
    });
}

const line = (level: number, msg: string) => JSON.stringify({ level, time: 1, msg });

/** Whether a promise has settled once pending callbacks have run. */
async function isSettled(promise: Promise<unknown>): Promise<boolean> {
    let settled = false;
    void promise.then(
        () => (settled = true),
        () => (settled = true),
    );
    await new Promise((resolve) => setImmediate(resolve));
    return settled;
}

const flushFanout = (fanout: Fanout) =>
    new Promise<Error | null | undefined>((resolve) => fanout.flush(resolve));

let dir: string;

/** Writes a target module under node_modules, where Vitest leaves loading to Node, as a worker would. */
function fixture(name: string, source: string): string {
    const path = join(dir, 'node_modules', 'fixtures', name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
    return path;
}

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'logger-worker-'));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('worker', () => {
    it('writes each line to the file targets and flushes them to disk', async () => {
        const all = join(dir, 'all.log');
        const errors = join(dir, 'errors.log');
        const fanout = await worker({
            targets: [
                { target: PINO_FILE, options: { destination: all }, level: 20 },
                { target: PINO_FILE, options: { destination: errors }, level: 50 },
            ],
        });

        const lines = Array.from({ length: 200 }, (_, i) => line(i % 2 ? 50 : 30, `entry ${i}`));
        fanout.write(`${lines.join('\n')}\n`);

        expect(await flushFanout(fanout)).toBeUndefined();
        expect(readFileSync(all, 'utf8')).toBe(`${lines.join('\n')}\n`);
        expect(readFileSync(errors, 'utf8').trim().split('\n')).toHaveLength(100);

        fanout.end();
        await once(fanout, 'close');
    });
});

describe('loadTarget', () => {
    it('loads a CommonJS target by path or file URL', async () => {
        expect(await loadTarget(PINO_FILE)).toBeTypeOf('function');
        expect(await loadTarget(pathToFileURL(PINO_FILE).href)).toBeTypeOf('function');
    });

    it('loads an ES module default export', async () => {
        const target = fixture('esm-target.mjs', 'export default function build() {}');

        expect(await loadTarget(target)).toBeTypeOf('function');
    });

    it('loads a default export transpiled to CommonJS', async () => {
        const target = fixture('cjs-default.js', 'exports.default = function build() {};');

        expect(await loadTarget(target)).toBeTypeOf('function');
    });

    it('refuses a module that does not export a function', async () => {
        const plainObject = require.resolve('pino-std-serializers');
        const nothing = fixture('null-target.js', 'module.exports = null;');

        for (const target of [plainObject, nothing]) {
            await expect(loadTarget(target)).rejects.toThrow(
                `Transport target "${target}" does not export a function`,
            );
        }
    });
});

describe('Fanout', () => {
    it('sends each line to the outputs whose level it meets', () => {
        const all = new FakeStream();
        const errors = new FakeStream();
        const fanout = new Fanout([
            { level: 20, stream: all },
            { level: 50, stream: errors },
        ]);

        fanout.write(`${line(20, 'debug')}\n${line(50, 'error')}\n`);

        expect(all.lines).toEqual([`${line(20, 'debug')}\n`, `${line(50, 'error')}\n`]);
        expect(errors.lines).toEqual([`${line(50, 'error')}\n`]);
    });

    it('joins lines split across writes and skips blank ones', () => {
        const stream = new FakeStream();
        const fanout = new Fanout([{ level: 20, stream: stream }]);
        const whole = line(30, 'split');

        fanout.write(whole.slice(0, 10));
        fanout.write(`${whole.slice(10)}\n\n`);

        expect(stream.lines).toEqual([`${whole}\n`]);
    });

    it('sends a line without a level to every output', () => {
        const stream = new FakeStream();
        const fanout = new Fanout([{ level: 50, stream: stream }]);

        fanout.write('not json\n');

        expect(stream.lines).toEqual(['not json\n']);
    });

    it('sets the entry on outputs that read Pino metadata', () => {
        const stream = Object.assign(new FakeStream(), { [Symbol.for('pino.metadata')]: true });
        const fanout = new Fanout([{ level: 20, stream: stream }]);

        fanout.write(`${line(40, 'warned')}\n`);

        expect(stream).toMatchObject({
            lastLevel: 40,
            lastTime: 1,
            lastMsg: 'warned',
            lastObj: { level: 40, time: 1, msg: 'warned' },
        });
    });

    it('writes a final partial line and ends every output before closing', async () => {
        const first = new FakeStream();
        const second = new FakeStream();
        const fanout = new Fanout([
            { level: 20, stream: first },
            { level: 20, stream: second },
        ]);

        fanout.end(line(30, 'last'));
        await once(fanout, 'close');

        expect(first.lines).toEqual([`${line(30, 'last')}\n`]);
        expect(first.end).toHaveBeenCalled();
        expect(second.end).toHaveBeenCalled();
    });

    it('passes a flush failure to the callback', async () => {
        const failing = Object.assign(new FakeStream(), {
            flush: (callback: (error?: Error | null) => void) => callback(new Error('disk full')),
        });
        const fanout = new Fanout([{ level: 20, stream: failing as TargetStream }]);

        expect(await flushFanout(fanout)).toEqual(new Error('disk full'));
    });
});

describe('flushStream', () => {
    const asTarget = (stream: object) => stream as TargetStream;

    it('resolves at once for an idle SonicBoom', async () => {
        const idle = Object.assign(new EventEmitter(), { _writing: false, minLength: 0 });
        const noMinLength = Object.assign(new EventEmitter(), { _writing: false });

        await expect(flushStream(asTarget(idle))).resolves.toBeUndefined();
        await expect(flushStream(asTarget(noMinLength))).resolves.toBeUndefined();
    });

    it('waits for a writing SonicBoom to drain', async () => {
        const sonic = Object.assign(new EventEmitter(), { _writing: true, minLength: 0 });

        const flushed = flushStream(asTarget(sonic));

        expect(await isSettled(flushed)).toBe(false);
        sonic.emit('drain');
        await expect(flushed).resolves.toBeUndefined();
    });

    it('uses flush(callback) for a SonicBoom with a minLength', async () => {
        const flush = vi.fn((callback: () => void) => callback());
        const sonic = Object.assign(new EventEmitter(), { _writing: true, minLength: 4096, flush });

        await flushStream(asTarget(sonic));

        expect(flush).toHaveBeenCalledTimes(1);
    });

    it('rejects when flush(callback) reports an error', async () => {
        const stream = Object.assign(new EventEmitter(), {
            flush: (callback: (error?: Error) => void) => callback(new Error('failed')),
        });

        await expect(flushStream(asTarget(stream))).rejects.toThrow('failed');
    });

    it('awaits a flush() that returns a promise', async () => {
        let done = false;
        const stream = Object.assign(new EventEmitter(), {
            flush: () =>
                new Promise<void>((resolve) => setImmediate(() => resolve(void (done = true)))),
        });

        await flushStream(asTarget(stream));

        expect(done).toBe(true);
    });

    it('calls flushSync when there is no flush', async () => {
        const flushSync = vi.fn();

        await flushStream(asTarget(Object.assign(new EventEmitter(), { flushSync })));

        expect(flushSync).toHaveBeenCalledTimes(1);
    });

    it('waits for drain when a plain stream needs it', async () => {
        const stream = Object.assign(new EventEmitter(), { writableNeedDrain: true });

        const flushed = flushStream(asTarget(stream));

        expect(await isSettled(flushed)).toBe(false);
        stream.emit('drain');
        await expect(flushed).resolves.toBeUndefined();
    });

    it('resolves at once for a stream with nothing to wait for', async () => {
        await expect(flushStream(asTarget(new EventEmitter()))).resolves.toBeUndefined();
    });
});
