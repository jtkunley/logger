import { EventEmitter } from 'events';
import { hostname } from 'os';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from '../logger';
import type { LoggerOptions } from '../types';
import { clearContext, setContext as configureContext } from './context-helpers';

/** Stands in for the thread-stream `pino.transport` returns. */
class FakeTransport extends EventEmitter {
    destroyed = false;
    readonly lines: string[] = [];
    readonly write = vi.fn((line: string) => {
        this.lines.push(line);
        return true;
    });
    readonly flush = vi.fn<(callback: (error?: Error) => void) => void>();

    entries(): Record<string, unknown>[] {
        return this.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    }
}

let transports: FakeTransport[];
let stderr: string[];

beforeEach(() => {
    transports = [];
    vi.spyOn(pino, 'transport').mockImplementation(() => {
        const transport = new FakeTransport();
        transports.push(transport);
        return transport as unknown as ReturnType<typeof pino.transport>;
    });

    stderr = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
        stderr.push(String(chunk));
        return true;
    });
});

afterEach(() => {
    clearContext();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/** A root logger writing to a fresh fake transport. */
function setup(options?: LoggerOptions, service = 'orders') {
    const root = init(service, options);
    const transport = transports.at(-1)!;
    return { root, transport, log: root.child('checkout', 'submit') };
}

/** Whether a promise has settled once pending microtasks have run; works under fake timers. */
async function isSettled(promise: Promise<unknown>): Promise<boolean> {
    let settled = false;
    void promise.then(() => (settled = true));
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
    return settled;
}

describe('init', () => {
    it('works without options and defaults to info', () => {
        const { log, transport } = setup();

        log.debug('hidden', {});
        log.info('shown', {});

        expect(transport.entries().map((entry) => entry['msg'])).toEqual(['shown']);
    });

    it('sends stdout and each transport through one worker transport', () => {
        setup({
            transports: [
                { target: 'pino/file', options: { destination: '/tmp/app.log' } },
                { target: 'pino-pretty', level: 'error' },
            ],
        });

        expect(pino.transport).toHaveBeenCalledWith({
            targets: [
                { target: 'pino/file', options: { destination: 1 }, level: 'debug' },
                { target: 'pino/file', options: { destination: '/tmp/app.log' }, level: 'debug' },
                { target: 'pino-pretty', options: {}, level: 'error' },
            ],
        });
    });

    it('creates a separate root each time, with its own service, level and output', () => {
        const first = setup({ level: 'error' }, 'first');
        const second = setup({ level: 'debug' }, 'second');
        configureContext({ shared: 'yes' });

        first.log.debug('first debug', {});
        first.log.error('first error', undefined, {});
        second.log.debug('second debug', {});

        expect(first.root).not.toBe(second.root);
        expect(first.transport.entries()).toEqual([
            expect.objectContaining({ service: 'first', msg: 'first error', shared: 'yes' }),
        ]);
        expect(second.transport.entries()).toEqual([
            expect.objectContaining({ service: 'second', msg: 'second debug', shared: 'yes' }),
        ]);
    });
});

describe('a child logger', () => {
    it('returns nothing from its logging methods', () => {
        const { log } = setup({ level: 'debug' });

        expect(log.debug('m', {})).toBeUndefined();
        expect(log.info('m', {})).toBeUndefined();
        expect(log.warn('m', {})).toBeUndefined();
        expect(log.error('m', new Error('e'), {})).toBeUndefined();
    });

    it('writes one newline-terminated JSON line per entry', () => {
        const { log, transport } = setup();

        log.info('one', {});
        log.info('two', {});

        expect(transport.lines).toHaveLength(2);
        for (const line of transport.lines) {
            expect(line.endsWith('\n')).toBe(true);
            expect(line.slice(0, -1)).not.toContain('\n');
        }
    });

    it('writes the standard fields', () => {
        const { log, transport } = setup();
        const before = Date.now();

        log.info('order placed', { orderId: 7 });

        const [entry] = transport.entries();
        expect(entry).toEqual({
            level: 30,
            time: expect.any(Number),
            service: 'orders',
            pid: process.pid,
            hostname: hostname(),
            module: 'checkout',
            action: 'submit',
            msg: 'order placed',
            data: { orderId: 7 },
        });
        expect(entry!['time']).toBeGreaterThanOrEqual(before);
        expect(entry!['time']).toBeLessThanOrEqual(Date.now());
    });

    it('writes numeric levels', () => {
        const { log, transport } = setup({ level: 'debug' });

        log.debug('d', {});
        log.info('i', {});
        log.warn('w', {});
        log.error('e', undefined, {});

        expect(transport.entries().map((entry) => entry['level'])).toEqual([20, 30, 40, 50]);
    });

    it('keeps data under data rather than at the top level', () => {
        const { log, transport } = setup();

        log.info('m', { userId: 'u1', msg: 'not the message', level: 'not the level' });

        const [entry] = transport.entries();
        expect(entry).not.toHaveProperty('userId');
        expect(entry!['msg']).toBe('m');
        expect(entry!['level']).toBe(30);
        expect(entry!['data']).toEqual({
            userId: 'u1',
            msg: 'not the message',
            level: 'not the level',
        });
    });

    it('keeps messages literally, without placeholder substitution', () => {
        const { log, transport } = setup();

        log.info('100% done for %s', {});

        expect(transport.entries()[0]!['msg']).toBe('100% done for %s');
    });

    it('bounds data', () => {
        const { log, transport } = setup();
        const nested = (n: number): unknown =>
            n === 0 ? { leaf: 'bottom' } : { next: nested(n - 1) };

        log.info('deep', nested(9) as Record<string, unknown>);

        expect(transport.lines[0]).toContain('[Object]');
        expect(transport.lines[0]).not.toContain('bottom');
    });

    it('logs data that cannot be read as [Unserializable], without throwing', () => {
        const { log, transport } = setup();
        const data = {
            get broken(): never {
                throw new Error('getter');
            },
        };

        expect(() => log.info('m', data)).not.toThrow();
        expect(transport.entries()[0]!['data']).toBe('[Unserializable]');
    });
});

describe('levels', () => {
    const emitted = (level: LoggerOptions['level']) => {
        const { log, transport } = setup({ level });
        log.debug('debug', {});
        log.info('info', {});
        log.warn('warn', {});
        log.error('error', undefined, {});
        return transport.entries().map((entry) => entry['msg']);
    };

    it('emits only errors at error', () => {
        expect(emitted('error')).toEqual(['error']);
    });

    it('emits warnings and errors at warn', () => {
        expect(emitted('warn')).toEqual(['warn', 'error']);
    });

    it('emits info and above at info', () => {
        expect(emitted('info')).toEqual(['info', 'warn', 'error']);
    });

    it('emits everything at debug', () => {
        expect(emitted('debug')).toEqual(['debug', 'info', 'warn', 'error']);
    });

    it('applies a level change to children that already exist', () => {
        const { root, log, transport } = setup();

        log.debug('before', {});
        root.level('debug');
        log.debug('after', {});
        root.level('error');
        log.warn('suppressed', {});

        expect(transport.entries().map((entry) => entry['msg'])).toEqual(['after']);
    });

    it('does not read data for suppressed entries', () => {
        const { log, transport } = setup({ level: 'error' });
        const getter = vi.fn(() => {
            throw new Error('read');
        });
        const data = Object.defineProperty({}, 'value', { get: getter, enumerable: true });

        log.debug('d', data);
        log.info('i', data);
        log.warn('w', data);

        expect(getter).not.toHaveBeenCalled();
        expect(transport.lines).toEqual([]);
    });

    it('does not call context resolvers for suppressed entries', () => {
        const { log } = setup({ level: 'warn' });
        const resolver = vi.fn(() => 'value');
        configureContext({ requestId: resolver });

        log.debug('d', {});
        log.info('i', {});

        expect(resolver).not.toHaveBeenCalled();

        log.warn('w', {});

        expect(resolver).toHaveBeenCalledTimes(1);
    });
});

describe('context', () => {
    it('adds context fields at the top level of every severity', () => {
        const { log, transport } = setup({ level: 'debug' });
        configureContext({ region: 'eu' });

        log.debug('d', {});
        log.info('i', {});
        log.warn('w', {});
        log.error('e', undefined, {});

        expect(transport.entries().map((entry) => entry['region'])).toEqual([
            'eu',
            'eu',
            'eu',
            'eu',
        ]);
    });

    it('applies to every root and child, whenever it is configured', () => {
        configureContext({ before: 1 });
        const first = setup();
        const second = setup();
        const other = first.root.child('billing', 'charge');
        configureContext({ after: 2 });

        first.log.info('m', {});
        other.info('m', {});
        second.log.info('m', {});

        for (const entry of [...first.transport.entries(), ...second.transport.entries()]) {
            expect(entry).toMatchObject({ before: 1, after: 2 });
        }
    });

    it('resolves functions for each entry', () => {
        const { log, transport } = setup();
        let requestId = 'a';
        configureContext({ requestId: () => requestId });

        log.info('m', {});
        requestId = 'b';
        log.info('m', {});

        expect(transport.entries().map((entry) => entry['requestId'])).toEqual(['a', 'b']);
    });

    it('neither overwrites nor repeats built-in fields', () => {
        const { log, transport } = setup();
        configureContext({ service: 'spoofed', msg: 'spoofed', module: 'spoofed', err: 'spoofed' });

        log.info('real', { a: 1 });

        const [line] = transport.lines;
        expect(line!.match(/"service"/g)).toHaveLength(1);
        expect(line!.match(/"msg"/g)).toHaveLength(1);
        expect(line).not.toContain('spoofed');
    });
});

describe('error entries', () => {
    it('logs an Error with Pino’s error serializer under err', () => {
        const { log, transport } = setup();

        log.error('failed', new TypeError('oops'), { orderId: 7 });

        const [entry] = transport.entries();
        expect(entry).toMatchObject({
            level: 50,
            msg: 'failed',
            data: { orderId: 7 },
            err: { type: 'TypeError', message: 'oops' },
        });
        expect((entry!['err'] as Record<string, string>)['stack']).toContain('TypeError: oops');
    });

    it('keeps and bounds enumerable error properties', () => {
        const { log, transport } = setup();
        const error = Object.assign(new Error('oops'), {
            code: 'E_OOPS',
            response: Array.from({ length: 101 }, (_, i) => i),
        });

        log.error('failed', error, {});

        const err = transport.entries()[0]!['err'] as Record<string, unknown>;
        expect(err['code']).toBe('E_OOPS');
        expect((err['response'] as unknown[]).at(-1)).toBe('... 1 item not stringified');
        expect(err['response']).toHaveLength(101);
    });

    it('includes the cause chain', () => {
        const { log, transport } = setup();

        log.error('failed', new Error('oops', { cause: new Error('root cause') }), {});

        const err = transport.entries()[0]!['err'] as Record<string, string>;
        expect(err['message']).toContain('oops: root cause');
        expect(err['stack']).toContain('caused by: Error: root cause');
    });

    it('logs other caught values as they are, bounded', () => {
        const { log, transport } = setup();

        log.error('string', 'plain string', {});
        log.error('object', { reason: 'denied', big: 1n }, {});

        expect(transport.entries().map((entry) => entry['err'])).toEqual([
            'plain string',
            { reason: 'denied', big: '1' },
        ]);
    });

    it('logs an error that cannot be serialized as [Unserializable], without throwing', () => {
        const { log, transport } = setup();
        const hostile = Object.defineProperty(new Error('hostile'), 'detail', {
            get(): never {
                throw new Error('getter');
            },
            enumerable: true,
        });

        expect(() => log.error('frozen', Object.freeze(new Error('frozen')), {})).not.toThrow();
        expect(() => log.error('hostile', hostile, { a: 1 })).not.toThrow();

        expect(transport.entries()).toEqual([
            expect.objectContaining({ msg: 'frozen', err: '[Unserializable]' }),
            expect.objectContaining({ msg: 'hostile', err: '[Unserializable]', data: { a: 1 } }),
        ]);
    });

    it('leaves err out when the caught value is undefined', () => {
        const { log, transport } = setup();

        log.error('failed', undefined, {});

        expect(transport.entries()[0]).not.toHaveProperty('err');
    });
});

describe('output', () => {
    it('writes to the transport while it is healthy', () => {
        const { log, transport } = setup();

        log.info('m', {});

        expect(transport.write).toHaveBeenCalledTimes(1);
        expect(stderr).toEqual([]);
    });

    it('reports the first transport error once on stderr', () => {
        const { transport } = setup({}, 'payments');
        const error = new Error('worker crashed');
        const before = Date.now();

        transport.emit('error', error);
        transport.emit('error', new Error('again'));

        expect(stderr).toHaveLength(1);
        expect(stderr[0]!.endsWith('\n')).toBe(true);
        const diagnostic = JSON.parse(stderr[0]!) as Record<string, unknown>;
        expect(diagnostic).toEqual({
            level: 50,
            time: expect.any(Number),
            service: 'payments',
            msg: 'Log transport failed; writing logs to stderr',
            err: { type: 'Error', message: 'worker crashed', stack: error.stack },
        });
        expect(diagnostic['time']).toBeGreaterThanOrEqual(before);
    });

    it('reports a transport error that is not an Error', () => {
        const { transport } = setup();

        transport.emit('error', 'worker gone');

        expect(JSON.parse(stderr[0]!)).toMatchObject({
            msg: 'Log transport failed; writing logs to stderr',
            err: { type: 'Error', message: 'worker gone' },
        });
    });

    it('keeps writing to the transport after an error while it is not destroyed', () => {
        const { log, transport } = setup();

        transport.emit('error', new Error('transient'));
        log.info('still here', {});

        expect(transport.entries()[0]!['msg']).toBe('still here');
        expect(stderr).toHaveLength(1);
    });

    it('writes entries to stderr once the transport is destroyed', () => {
        const { log, transport } = setup();

        transport.destroyed = true;
        log.info('rerouted', { a: 1 });

        expect(transport.write).not.toHaveBeenCalled();
        expect(stderr).toHaveLength(1);
        expect(JSON.parse(stderr[0]!)).toMatchObject({ msg: 'rerouted', data: { a: 1 } });
    });

    it('does not replace a failed transport', () => {
        const { log, transport } = setup();

        transport.emit('error', new Error('dead'));
        transport.destroyed = true;
        log.info('m', {});

        expect(pino.transport).toHaveBeenCalledTimes(1);
    });
});

describe('flush', () => {
    it('stays pending until the transport calls back, then resolves with nothing', async () => {
        const { root, transport } = setup();

        const flushed = root.flush();

        expect(await isSettled(flushed)).toBe(false);
        transport.flush.mock.calls[0]![0]();
        await expect(flushed).resolves.toBeUndefined();
    });

    it('resolves after 10 seconds when the transport never calls back', async () => {
        vi.useFakeTimers();
        const { root } = setup();

        const flushed = root.flush();

        await vi.advanceTimersByTimeAsync(9_999);
        expect(await isSettled(flushed)).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await expect(flushed).resolves.toBeUndefined();
    });

    it('cancels the timeout when the transport calls back first', async () => {
        vi.useFakeTimers();
        const { root, transport } = setup();

        const flushed = root.flush();
        expect(vi.getTimerCount()).toBe(1);
        transport.flush.mock.calls[0]![0]();

        await expect(flushed).resolves.toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('resolves when the transport calls back with an error', async () => {
        const { root, transport } = setup();

        const flushed = root.flush();
        transport.flush.mock.calls[0]![0](new Error('flush failed'));

        await expect(flushed).resolves.toBeUndefined();
    });

    it('resolves at once without flushing a destroyed transport', async () => {
        const { root, transport } = setup();
        transport.destroyed = true;

        await expect(root.flush()).resolves.toBeUndefined();
        expect(transport.flush).not.toHaveBeenCalled();
    });
});
