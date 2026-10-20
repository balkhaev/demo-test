import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';

const api = 'https://deploy.balkhaev.com/api/v1';
const application = 'mfxgu1aixgrccifhjooxbcqk';
const site = 'https://demo.balkhaev.com';
const token = process.env.COOLIFY_ACCESS_TOKEN;
if (!token) throw new Error('Set COOLIFY_ACCESS_TOKEN before deploying.');

async function request(path, method = 'GET') {
  const response = await fetch(api + path, {
    method, headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Coolify ${method} ${path}: HTTP ${response.status}`);
  return response.json();
}

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const config = await request(`/applications/${application}`);
if (config.git_repository !== 'balkhaev/demo-test' || config.git_branch !== 'main' || config.fqdn !== site) {
  throw new Error('Production application no longer matches this repository, branch and domain.');
}
const history = await request(`/deployments/applications/${application}`);
const existing = history.deployments?.find(item =>
  item.commit === commit && ['queued', 'in_progress', 'finished'].includes(item.status));
const deployment = existing?.deployment_uuid
  ?? (await request(`/deploy?uuid=${application}&force=true`, 'POST')).deployments?.[0]?.deployment_uuid;
if (!deployment) throw new Error('Coolify did not return a deployment ID.');
console.info(`Checking deployment ${deployment} for ${commit}`);

const deadline = Date.now() + 10 * 60_000;
let finished = false;
while (Date.now() < deadline) {
  const result = await request(`/deployments/${deployment}`);
  if (result.status === 'finished') {
    if (result.commit !== commit) throw new Error(`Deployed ${result.commit}, expected ${commit}.`);
    finished = true;
    break;
  }
  if (['failed', 'cancelled', 'cancelled-by-user'].includes(result.status)) {
    throw new Error(`Deployment ${result.status}; inspect it in Coolify.`);
  }
  await wait(10_000);
}
if (!finished) throw new Error('Deployment timed out; inspect it in Coolify before retrying.');

const health = await fetch(site + '/api/health', { signal: AbortSignal.timeout(30_000) });
if (!health.ok || (await health.json()).status !== 'ok') throw new Error('Production health check failed.');
for (const file of ['index.html', 'app.js', 'styles.css', 'logic-view.js', 'logic-guide.js']) {
  const response = await fetch(`${site}/${file === 'index.html' ? '' : file}?v=${commit}`, {
    signal: AbortSignal.timeout(30_000),
  });
  const expected = await readFile(new URL('../dist/' + file, import.meta.url), 'utf8');
  if (!response.ok || (await response.text()).replace(/\r\n/g, '\n') !== expected.replace(/\r\n/g, '\n')) {
    throw new Error(`Production file does not match this commit: ${file}`);
  }
}
console.info(`Verified ${commit} at ${site}/#/logic`);
