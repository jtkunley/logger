import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'dist';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
delete pkg.scripts;
delete pkg.devDependencies;
writeFileSync(join(outDir, 'package.json'), `${JSON.stringify(pkg, null, 4)}\n`);

for (const file of ['README.md', 'CHANGELOG.md', 'LICENSE']) {
    copyFileSync(file, join(outDir, file));
}
