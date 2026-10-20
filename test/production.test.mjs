import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, cp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';

test('Docker runtime files start standalone, including with inherited DevHub variables', async () => {
  const root = await mkdtemp(join(tmpdir(), 'support-demo-test-'));
  try {
    for (const path of ['package.json', 'domain', 'fixtures', 'prompts', 'server', 'dist']) {
      await cp(resolve(path), join(root, path), { recursive: true });
    }
    await mkdir(join(root, 'test'));
    await cp(resolve('test/engine.test.mjs'), join(root, 'test/engine.test.mjs'));
    let cleanHeaders;
    for (const inherited of [false, true]) {
      const probe = createServer();
      await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
      const port = probe.address().port;
      await new Promise(resolve => probe.close(resolve));
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('DEVHUB_')));
      Object.assign(env, { HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'production', SOURCE_COMMIT: 'a'.repeat(40) });
      if (inherited) Object.assign(env, { DEVHUB_ROOT: '/missing-devhub', DEVHUB_MANAGED: '1', DEVHUB_PROJECT: '/missing-project' });
      const child = spawn(process.execPath, ['server/http.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let log = '';
      child.stdout.on('data', chunk => { log += chunk; });
      child.stderr.on('data', chunk => { log += chunk; });
      const exited = once(child, 'exit');
      try {
        const base = `http://127.0.0.1:${port}`;
        let ready = false;
        for (let attempt = 0; attempt < 60; attempt++) {
          if (child.exitCode !== null) throw new Error(log);
          try { ready = (await fetch(base + '/api/health')).ok; } catch {}
          if (ready) break;
          await wait(50);
        }
        assert.ok(ready, log);
        const response = await fetch(base + '/api/demo');
        assert.equal(response.status, 200);
        assert.equal((await response.json()).counts.attention, 3);
        const headers = ['cache-control', 'content-type', 'x-content-type-options', 'referrer-policy']
          .map(key => [key, response.headers.get(key)]);
        if (inherited) assert.deepEqual(headers, cleanHeaders); else cleanHeaders = headers;
        assert.equal((await fetch(base + '/api/source/onboarding')).status, 200);
        assert.equal((await fetch(base + '/logic-view.js')).status, 200);
        assert.equal((await fetch(base + '/highlight.js')).status, 200);
        const guide = await (await fetch(base + '/api/logic')).json();
        assert.equal(guide.revision, 'a'.repeat(40));
        assert.ok(guide.topics.delivery.rules[0].source.url.includes('/blob/' + 'a'.repeat(40) + '/'));
      } finally {
        child.kill();
        await exited;
      }
    }
  } finally {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('support-demo-test-')) {
      throw new Error('Refusing to remove a path outside the test temporary directory.');
    }
    await rm(root, { recursive: true, force: true });
  }
});
