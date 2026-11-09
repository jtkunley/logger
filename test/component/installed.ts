import { execFile } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { inject } from 'vitest';

const execFileAsync = promisify(execFile);

/** Where the package is installed, as a service would install it. */
export const consumerDir = inject('consumerDir');

/** A fresh directory inside the consumer, for log files and helper modules. */
export function workDir(): string {
    return mkdtempSync(join(consumerDir, 'work-'));
}

export interface ConsumerRun {
    stdout: Record<string, unknown>[];
    stderr: Record<string, unknown>[];
}

/**
 * Runs `body` as an async CommonJS script in a separate Node process, with
 * `logger` required from the installed package and `args` holding `argv`.
 * Returns stdout and stderr parsed as JSON lines.
 */
export async function runConsumer(body: string, args: string[] = []): Promise<ConsumerRun> {
    const script = join(workDir(), 'consumer.js');
    writeFileSync(
        script,
        [
            `const { logger } = require('@jtkunley/logger');`,
            `const args = process.argv.slice(2);`,
            `(async () => {`,
            body,
            `})();`,
        ].join('\n'),
    );
    const { stdout, stderr } = await execFileAsync(process.execPath, [script, ...args], {
        cwd: consumerDir,
        // Below the component test timeout, so a hung script is killed before the test gives up.
        timeout: 12_000,
    });
    return { stdout: parseLines(stdout), stderr: parseLines(stderr) };
}

/** Reads a file of JSON lines. */
export function readEntries(path: string): Record<string, unknown>[] {
    return parseLines(readFileSync(path, 'utf8'));
}

function parseLines(text: string): Record<string, unknown>[] {
    return text
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
}
