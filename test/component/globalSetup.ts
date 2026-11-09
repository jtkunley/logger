import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
    export interface ProvidedContext {
        consumerDir: string;
    }
}

const REPO = resolve(__dirname, '../..');

/**
 * Builds the package the way it is published and installs it beside the real
 * pino, so the tests load it through the exports map.
 */
export default function setup({ provide }: TestProject): () => void {
    const root = mkdtempSync(join(tmpdir(), 'logger-component-'));
    const packageDir = join(root, 'node_modules', '@jtkunley', 'logger');
    const run = (...args: string[]) => execFileSync(process.execPath, args, { cwd: REPO });

    run(
        require.resolve('typescript/bin/tsc'),
        '-p',
        'tsconfig.build.json',
        '--outDir',
        join(packageDir, 'src'),
    );
    run('scripts/prepare-dist.mjs', packageDir);
    symlinkSync(join(REPO, 'node_modules', 'pino'), join(root, 'node_modules', 'pino'));

    provide('consumerDir', root);
    return () => rmSync(root, { recursive: true, force: true });
}
