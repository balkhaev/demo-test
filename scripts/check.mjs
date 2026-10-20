import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Check every module, including browser imports and split domain rules.
for (const directory of ['domain', 'dist', 'fixtures', 'server', 'scripts', 'test']) {
  for (const file of readdirSync(directory, { recursive: true })) {
    if (!/\.(?:mjs|js)$/.test(file)) continue;
    const result = spawnSync(process.execPath, ['--check', join(directory, file)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
