import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'fs';
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
 * Builds and packs the package the way it is published, then unpacks the
 * tarball beside the real pino, so the tests load only the files that ship,
 * through the exports map.
 */
export default function setup({ provide }: TestProject): () => void {
    const root = mkdtempSync(join(tmpdir(), 'logger-component-'));
    const staging = join(root, 'staging');
    const packageDir = join(root, 'node_modules', '@jtkunley', 'logger');
    const node = (...args: string[]) => execFileSync(process.execPath, args, { cwd: REPO });

    node(
        require.resolve('typescript/bin/tsc'),
        '-p',
        'tsconfig.build.json',
        '--outDir',
        join(staging, 'src'),
    );
    node('scripts/prepare-dist.mjs', staging);
    const tarball = execFileSync('npm', ['pack', '--silent', '--pack-destination', root], {
        cwd: staging,
        encoding: 'utf8',
    }).trim();

    mkdirSync(packageDir, { recursive: true });
    execFileSync('tar', ['-xzf', join(root, tarball), '-C', packageDir, '--strip-components=1']);
    symlinkSync(join(REPO, 'node_modules', 'pino'), join(root, 'node_modules', 'pino'));

    provide('consumerDir', root);
    return () => rmSync(root, { recursive: true, force: true });
}
