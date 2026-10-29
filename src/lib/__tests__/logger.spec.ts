import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { logger } from '../../index';

function readEntries(file: string): Record<string, unknown>[] {
    return readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('init', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'logger-'));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('should write to transports in a worker thread, honouring per-transport levels', async () => {
        const all = join(dir, 'all.log');
        const errors = join(dir, 'errors.log');
        const rootLogger = logger.init('SampleServiceName', {
            level: 'debug',
            transports: [
                { target: 'pino/file', options: { destination: all } },
                {
                    target: 'pino/file',
                    options: { destination: errors },
                    level: 'error',
                },
            ],
        });
        rootLogger.level('error');
        const log = rootLogger.child('someService', 'someAction');
        log.debug('debug message', {});
        log.error('error message', 'failure', { key: 'value' });
        await rootLogger.flush();

        const expected = [
            expect.objectContaining({
                level: 50,
                service: 'SampleServiceName',
                msg: 'error message',
                err: 'failure',
                data: { key: 'value' },
            }),
        ];
        expect(readEntries(all)).toEqual(expected);
        expect(readEntries(errors)).toEqual(expected);
    });

    it('should start with no options', async () => {
        const rootLogger = logger.init('SampleServiceName');
        rootLogger.child('someService', 'someAction').debug('hidden', {});
        await expect(rootLogger.flush()).resolves.toBeUndefined();
    });
});
