import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server/http.js';
import { SAMPLE } from '../fixtures/demo.js';
import { evaluateBrief } from '../domain/brief-service.js';
import { validateSnapshot, DomainInputError } from '../domain/validation.js';

let server;
let base;
before(async () => {
  server = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

const input = () => ({ asOf: SAMPLE.asOf, cases: structuredClone(SAMPLE.cases) });
const evaluate = body => fetch(base + '/api/evaluate', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('HTTP demo provides a server-computed summary and explicit snapshot time', async () => {
  const response = await fetch(base + '/api/demo');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json; charset=utf-8/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.asOf, SAMPLE.asOf);
  assert.deepEqual(body.snapshot, SAMPLE.snapshot);
  assert.deepEqual(body.counts, { total: 4, attention: 3, done: 1, urgent: 1 });
  assert.equal(body.summary[0].id, 'П-08');
  assert.ok(body.rulesVersion);
});

test('HTTP evaluation changes only the submitted snapshot, never another visitor demo', async () => {
  const changed = input();
  changed.cases.find(item => item.id === 'С-17').crm.documents = 'accepted';
  const first = await (await evaluate(changed)).json();
  assert.equal(first.counts.attention, 2);
  const second = await (await fetch(base + '/api/demo')).json();
  assert.equal(second.counts.attention, 3);
  assert.equal(second.cases.find(item => item.id === 'С-17').crm.documents, 'pending');
});

test('business service is deterministic and returns isolated input and output snapshots', () => {
  const original = input();
  const before = structuredClone(original);
  const result = evaluateBrief(original);
  assert.deepEqual(original, before);
  assert.deepEqual(evaluateBrief(original), result);
  original.cases[0].message.text = 'Changed after evaluation';
  assert.notEqual(result.cases[0].message.text, original.cases[0].message.text);
  assert.notEqual(result.summary.find(item => item.id === original.cases[0].id).message.text, original.cases[0].message.text);
});

test('HTTP validation reports the exact invalid field instead of coercing confirmations', async () => {
  const invalid = input();
  invalid.cases[1].crm.managerApproved = 'true';
  const response = await evaluate(invalid);
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.error.code, 'INVALID_FIELD');
  assert.equal(body.error.fields[0].path, 'cases[1].crm.managerApproved');
});

test('nullable business confirmations are accepted but do not silently become success', async () => {
  const unknown = input();
  unknown.cases[1].crm.managerApproved = null;
  const response = await evaluate(unknown);
  assert.equal(response.status, 200);
  const result = (await response.json()).summary.find(item => item.id === 'С-24');
  assert.equal(result.needsAttention, true);
});

test('duplicate case identities fail explicitly', async () => {
  const invalid = input();
  invalid.cases[1].id = invalid.cases[0].id;
  const response = await evaluate(invalid);
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.error.code, 'DUPLICATE_CASE_ID');
  assert.equal(body.error.fields[0].path, 'cases[1].id');
});

test('conflicting calendar and exact deadlines fail before a contradictory priority can be computed', async () => {
  const invalid = input();
  invalid.cases[0].dueDate = '2026-10-18';
  invalid.cases[0].dueAt = '2026-10-21T10:00:00+03:00';
  assert.throws(() => evaluateBrief(invalid), error => error.code === 'CONFLICTING_DEADLINES' && error.path === 'cases[0].dueAt');
  const response = await evaluate(invalid);
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.error.code, 'CONFLICTING_DEADLINES');
  assert.equal(body.error.fields[0].path, 'cases[0].dueAt');
  assert.equal(Object.hasOwn(body, 'summary'), false);
});

test('validation rejects invalid calendar dates, absent time zones, unknown fields and excess cases', () => {
  for (const invalidAsOf of ['2026-02-30T10:00:00+03:00', '2026-10-19T10:00:00', '2026-10-19T25:00:00+03:00']) {
    assert.throws(() => validateSnapshot({ ...input(), asOf: invalidAsOf }), DomainInputError);
  }
  assert.throws(() => validateSnapshot({ ...input(), writeToCRM: true }), error => error.path === 'writeToCRM');
  assert.throws(() => validateSnapshot({ asOf: SAMPLE.asOf, cases: Array.from({ length: 51 }, (_, index) => ({ ...SAMPLE.cases[0], id: 'case-' + index })) }), error => error.code === 'INVALID_CASES');
});

test('HTTP malformed JSON and incorrect content types get actionable errors', async () => {
  let response = await fetch(base + '/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_JSON');
  response = await fetch(base + '/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(response.status, 415);
  assert.equal((await response.json()).error.code, 'JSON_REQUIRED');
});

test('HTTP request body has a strict 64 KiB limit', async () => {
  const response = await fetch(base + '/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(65536) }) });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'PAYLOAD_TOO_LARGE');
});

test('HTTP body limit also applies without a declared Content-Length', async () => {
  const response = await new Promise((resolve, reject) => {
    const request = httpRequest(base + '/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    request.on('error', reject);
    request.write('x'.repeat(40_000));
    request.end('x'.repeat(40_000));
  });
  assert.equal(response.status, 413);
  assert.equal(response.body.error.code, 'PAYLOAD_TOO_LARGE');
});

test('published source is limited to actual business files', async () => {
  const response = await fetch(base + '/api/source/service');
  assert.equal(response.status, 200);
  const source = await response.json();
  assert.equal(source.path, 'domain/brief-service.js');
  assert.equal(source.language, 'javascript');
  assert.match(source.content, /export function evaluateBrief/);
  for (const [key, path] of Object.entries({
    rules: 'domain/rules.js',
    delivery: 'domain/rules/delivery.js',
    onboarding: 'domain/rules/onboarding.js',
    offboarding: 'domain/rules/offboarding.js',
    deadlines: 'domain/deadlines.js',
    evidence: 'domain/evidence.js',
  })) {
    const response = await fetch(base + '/api/source/' + key);
    assert.equal(response.status, 200);
    const file = await response.json();
    assert.equal(file.path, path);
    assert.ok(file.content.length > 0);
  }
  for (const key of ['http', 'app', '__proto__', 'package.json']) {
    const hidden = await fetch(base + '/api/source/' + key);
    assert.equal(hidden.status, 404);
  }
});

test('static delivery serves explicit public files and denies directory traversal', async () => {
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html; charset=utf-8/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(await page.text(), /<script[^>]+type="module"/);
  for (const file of ['logic-view.js', 'logic-guide.js']) {
    const module = await fetch(base + '/' + file + '?v=4');
    assert.equal(module.status, 200);
    assert.match(module.headers.get('content-type'), /text\/javascript/);
  }
  const script = await fetch(base + '/app.js?v=test');
  assert.equal(script.status, 200);
  assert.equal(script.headers.get('cache-control'), 'public, max-age=3600');
  for (const path of ['/package.json', '/domain/rules.js', '/%2e%2e%2fpackage.json', '/server/http.js', '/.env']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
});

test('health check and unsupported methods have predictable responses', async () => {
  assert.deepEqual(await (await fetch(base + '/api/health')).json(), { status: 'ok' });
  assert.equal((await fetch(base + '/api/evaluate')).status, 405);
  assert.equal((await fetch(base + '/api/demo', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/api/unknown')).status, 404);
});
