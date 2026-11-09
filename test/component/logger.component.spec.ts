import { writeFileSync } from 'fs';
import { hostname } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { readEntries, runConsumer, workDir } from './installed';

const messages = (entries: Record<string, unknown>[]) => entries.map((entry) => entry['msg']);

describe('the installed logger on real Pino transports', () => {
    it('has written every severity to stdout and to file transports, filtered by level, once flush resolves', async () => {
        const dir = workDir();
        const all = join(dir, 'all.log');
        const errors = join(dir, 'errors.log');

        // The files are copied as soon as flush resolves, before the exit hook
        // could flush them, so the copies show what flush itself waited for.
        const { stdout } = await runConsumer(
            `
            const { copyFileSync } = require('fs');
            const root = logger.init('orders', {
                level: 'debug',
                transports: [
                    { target: 'pino/file', options: { destination: args[0] } },
                    { target: 'pino/file', options: { destination: args[1] }, level: 'error' },
                ],
            });
            const log = root.child('checkout', 'submit');
            log.debug('debug', {});
            log.info('info', {});
            log.warn('warn', {});
            log.error('error', new Error('boom'), { orderId: 7 });
            await root.flush();
            copyFileSync(args[0], args[0] + '.flushed');
            copyFileSync(args[1], args[1] + '.flushed');
            `,
            [all, errors],
        );

        expect(messages(stdout)).toEqual(['debug', 'info', 'warn', 'error']);
        expect(messages(readEntries(`${all}.flushed`))).toEqual(['debug', 'info', 'warn', 'error']);
        expect(readEntries(`${errors}.flushed`)).toEqual([
            {
                level: 50,
                time: expect.any(Number),
                service: 'orders',
                pid: expect.any(Number),
                hostname: hostname(),
                module: 'checkout',
                action: 'submit',
                msg: 'error',
                data: { orderId: 7 },
                err: { type: 'Error', message: 'boom', stack: expect.stringContaining('boom') },
            },
        ]);
    });

    it('applies root level changes to every output, keeping transport levels', async () => {
        const dir = workDir();
        const all = join(dir, 'all.log');
        const errors = join(dir, 'errors.log');

        const { stdout } = await runConsumer(
            `
            const root = logger.init('orders', {
                transports: [
                    { target: 'pino/file', options: { destination: args[0] } },
                    { target: 'pino/file', options: { destination: args[1] }, level: 'error' },
                ],
            });
            const log = root.child('checkout', 'submit');
            log.debug('suppressed at info', {});
            root.level('debug');
            log.debug('emitted at debug', {});
            root.level('error');
            log.warn('suppressed at error', {});
            log.error('emitted at error', undefined, {});
            await root.flush();
            `,
            [all, errors],
        );

        expect(messages(stdout)).toEqual(['emitted at debug', 'emitted at error']);
        expect(messages(readEntries(all))).toEqual(['emitted at debug', 'emitted at error']);
        expect(messages(readEntries(errors))).toEqual(['emitted at error']);
    });

    it('adds configured context to entries in every output', async () => {
        const dir = workDir();
        const file = join(dir, 'app.log');

        const { stdout } = await runConsumer(
            `
            let requestId = 'r1';
            logger.configureContext({ region: 'eu', requestId: () => requestId });
            const root = logger.init('orders', {
                transports: [{ target: 'pino/file', options: { destination: args[0] } }],
            });
            const log = root.child('checkout', 'submit');
            log.info('first', {});
            requestId = 'r2';
            log.info('second', {});
            await root.flush();
            `,
            [file],
        );

        for (const entries of [stdout, readEntries(file)]) {
            expect(entries).toEqual([
                expect.objectContaining({ msg: 'first', region: 'eu', requestId: 'r1' }),
                expect.objectContaining({ msg: 'second', region: 'eu', requestId: 'r2' }),
            ]);
        }
    });

    it('reports a failed transport once and falls back to stderr', async () => {
        const dir = workDir();
        const crashingTarget = join(dir, 'crashing-target.js');
        writeFileSync(
            crashingTarget,
            `
            const { Writable } = require('stream');
            module.exports = () =>
                new Writable({
                    write(chunk, encoding, callback) {
                        callback();
                        setImmediate(() => {
                            throw new Error('target crashed');
                        });
                    },
                });
            `,
        );

        // thread-stream marks the stream destroyed before emitting the error, so
        // once the diagnostic is written the next entry must go to stderr.
        const { stderr } = await runConsumer(
            `
            const reported = new Promise((resolve) => {
                const write = process.stderr.write.bind(process.stderr);
                process.stderr.write = (chunk, ...rest) => {
                    const written = write(chunk, ...rest);
                    if (String(chunk).includes('Log transport failed')) resolve();
                    return written;
                };
            });
            const root = logger.init('payments', { transports: [{ target: args[0] }] });
            const log = root.child('ledger', 'post');
            log.info('crashes the transport', {});
            await root.flush();
            await reported;
            log.info('after the failure', { attempt: 2 });
            await root.flush();
            `,
            [crashingTarget],
        );

        expect(stderr).toEqual([
            {
                level: 50,
                time: expect.any(Number),
                service: 'payments',
                msg: 'Log transport failed; writing logs to stderr',
                err: {
                    type: 'Error',
                    message: expect.stringContaining('target crashed'),
                    stack: expect.any(String),
                },
            },
            expect.objectContaining({
                level: 30,
                service: 'payments',
                msg: 'after the failure',
                data: { attempt: 2 },
            }),
        ]);
    });
});
