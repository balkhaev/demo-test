import assert from 'node:assert/strict';
import test from 'node:test';
import { topics, logicText, topicForRule } from '../dist/logic-guide.js';
import { logicRoute, logicView } from '../dist/logic-view.js';
import { deliveryRules } from '../domain/rules/delivery.js';
import { onboardingRules } from '../domain/rules/onboarding.js';
import { offboardingRules } from '../domain/rules/offboarding.js';
import { SAMPLE } from '../fixtures/demo.js';
import { evaluateCase } from '../domain/rules.js';

test('every business branch has a pseudocode explanation in execution order', () => {
  for (const [kind, rules] of Object.entries({ delivery: deliveryRules, onboarding: onboardingRules, offboarding: offboardingRules })) {
    const item = SAMPLE.cases.find(value => value.kind === kind);
    const actual = rules(item, SAMPLE.asOf).map(rule => rule.id);
    assert.deepEqual(topics[kind].rules.map(rule => rule[0]), actual);
    for (const id of actual) {
      assert.equal(topicForRule(id), kind);
      assert.ok(logicText(kind).includes(id));
    }
  }
  const item = structuredClone(SAMPLE.cases.find(item => item.kind === 'delivery'));
  item.message.occurredAt = '2026-10-20T10:00:00+03:00';
  assert.equal(topicForRule(evaluateCase(item, SAMPLE.asOf).ruleId), 'validation');
});

test('case links select the exact explanation and corresponding source module', () => {
  for (const topic of Object.values(topics)) {
    for (const [id] of topic.rules ?? []) {
      const route = logicRoute(new URLSearchParams({ file: 'rules', rule: id }));
      assert.equal(route.topic, topicForRule(id));
      assert.equal(route.file, id.startsWith('DATA.') ? 'rules' : topic.file);
      assert.equal(route.source, false);
      assert.match(logicView(route), /id="selected-rule"/);
    }
  }
});

test('the default guide is short pseudocode; source code is opt-in', () => {
  const route = logicRoute(new URLSearchParams());
  assert.equal(route.topic, 'overview');
  const html = logicView(route);
  assert.match(html, /ПРИМЕНИТЬ первое подходящее правило/);
  assert.doesNotMatch(html, /id="code-content"/);
  const source = logicView(logicRoute(new URLSearchParams('topic=delivery&view=source')));
  assert.match(source, /id="code-content"/);
  assert.doesNotMatch(source, /class="pseudocode"/);
});

test('old section links remain valid and unknown parameters cannot inject HTML', () => {
  assert.equal(logicRoute(new URLSearchParams('file=service')).topic, 'overview');
  assert.equal(logicRoute(new URLSearchParams('file=rules')).topic, 'delivery');
  assert.equal(logicRoute(new URLSearchParams('file=tests')).topic, 'tests');
  for (const topic of ['__proto__', 'constructor', '<script>']) {
    assert.equal(logicRoute(new URLSearchParams({ topic })).topic, 'overview');
  }
  const html = logicView(logicRoute(new URLSearchParams({ rule: '"><img src=x onerror=alert(1)>' })));
  assert.match(html, /Правило не найдено/);
  assert.doesNotMatch(html, /<img/);
});
