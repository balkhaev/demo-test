import assert from 'node:assert/strict';
import test from 'node:test';
import { getLogicGuide } from '../server/logic-guide.js';
import { readSource } from '../server/source-files.js';
import { logicText, topicForRule } from '../dist/logic-guide.js';
import { logicRoute, logicView } from '../dist/logic-view.js';
import { highlight } from '../dist/highlight.js';
import { RULE_SETS, evaluateCase } from '../domain/rules.js';
import { dataRules } from '../domain/rules/data.js';
import { deadlineRules } from '../domain/rules/deadline.js';
import { eq, field, before, instant, evaluate, describe } from '../domain/expressions.js';
import { SAMPLE } from '../fixtures/demo.js';

test('guide covers every executable branch in its real order and links to its actual source lines', async () => {
  const { topics } = await getLogicGuide();
  const groups = { ...RULE_SETS, validation: dataRules, priority: deadlineRules };
  for (const [kind, definitions] of Object.entries(groups)) {
    assert.deepEqual(topics[kind].rules.map(rule => rule.id), definitions.map(rule => rule.id));
    const source = await readSource(topics[kind].file);
    const lines = source.content.split('\n');
    for (const rule of topics[kind].rules) {
      assert.equal(topicForRule(topics, rule.id), kind);
      assert.ok(logicText(topics, kind).includes(rule.id));
      assert.ok(lines[rule.source.line - 1].includes(`"${rule.id}"`));
      const range = lines.slice(rule.source.line - 1, rule.source.endLine).join('\n');
      assert.match(range, /when:/);
      assert.match(range, /then:/);
      assert.equal(rule.source.url, `${source.githubUrl}#L${rule.source.line}-L${rule.source.endLine}`);
    }
  }
});

test('changing one condition and outcome changes both real evaluation and the generated page', async () => {
  const definition = RULE_SETS.delivery[0];
  const original = { when: definition.when, then: definition.then };
  const item = structuredClone(SAMPLE.cases.find(value => value.id === 'П-09'));
  try {
    assert.equal(evaluateCase(item, SAMPLE.asOf).ruleId, 'DELIVERY.CONFIRMED');
    definition.when = eq(field('message.signal'), 'received');
    definition.then = {
      ...definition.then, priority: 'today',
      action: 'Проверить изменённое правило', check: 'Новая проверка',
      closureConditions: ['Новое условие закрытия'],
    };
    const result = evaluateCase(item, SAMPLE.asOf);
    const { topics } = await getLogicGuide();
    const generated = topics.delivery.rules[0];
    assert.equal(result.ruleId, definition.id);
    assert.equal(result.priority, 'today');
    assert.equal(generated.priority, 'СЕГОДНЯ');
    assert.equal(generated.condition, 'сообщение.сигнал = "получено"');
    assert.equal(generated.action, result.action);
    assert.equal(generated.check, result.check);
    assert.deepEqual(generated.closureConditions, result.closureConditions);
    const html = logicView(logicRoute(new URLSearchParams({ rule: definition.id }), topics), topics);
    assert.match(html, /Проверить изменённое правило/);
    assert.match(html, /Новое условие закрытия/);
    assert.match(html, /syntax-keyword/);
    assert.match(html, /GitHub · L/);
  } finally {
    Object.assign(definition, original);
  }
});

test('deadline edits also reach both case priority and the guide without a second description', async () => {
  const definition = deadlineRules.find(rule => rule.id === 'DEADLINE.FUTURE');
  const original = definition.then.priority;
  try {
    definition.then.priority = 'urgent';
    const item = SAMPLE.cases.find(item => item.id === 'С-17');
    assert.equal(evaluateCase(item, SAMPLE.asOf).priority, 'urgent');
    const { topics } = await getLogicGuide();
    assert.equal(topics.priority.rules.at(-1).priority, 'СЕЙЧАС');
  } finally {
    definition.then.priority = original;
  }
});

test('date comparisons preserve unknowns, exact instants and strict boundary behavior', () => {
  const condition = before(instant(field('message.occurredAt')), instant(field('crm.receivedAt')));
  const item = structuredClone(SAMPLE.cases.find(value => value.id === 'П-09'));
  assert.equal(evaluate(condition, item), false);
  item.message.occurredAt = '2026-10-19T06:20:00Z';
  assert.equal(evaluate(condition, item), false);
  item.message.occurredAt = '2026-10-19T06:19:59Z';
  assert.equal(evaluate(condition, item), true);
  assert.match(describe(condition), /МОМЕНТ\(сообщение\.время\) < МОМЕНТ\(CRM\.время_приёмки\)/);
  assert.throws(() => evaluate({ op: 'unimplemented' }, item), /Unknown rule expression/);
  assert.throws(() => describe({ op: 'unimplemented' }), /Unknown rule expression/);
});

test('case links select the exact explanation and corresponding source module', async () => {
  const { topics } = await getLogicGuide();
  for (const topic of Object.values(topics)) {
    for (const { id } of topic.rules ?? []) {
      const route = logicRoute(new URLSearchParams({ file: 'rules', rule: id }), topics);
      assert.equal(route.topic, topicForRule(topics, id));
      assert.equal(route.file, topic.file);
      assert.equal(route.source, false);
      assert.match(logicView(route, topics), /id="selected-rule"/);
    }
  }
});

test('default guide, old section links and hostile URL parameters remain safe', async () => {
  const { topics } = await getLogicGuide();
  const route = query => logicRoute(new URLSearchParams(query), topics);
  assert.equal(route('').topic, 'overview');
  assert.match(logicView(route(''), topics), /первое совпадение/);
  assert.doesNotMatch(logicView(route(''), topics), /id="code-content"/);
  assert.match(logicView(route('topic=delivery&view=source'), topics), /id="code-content"/);
  assert.equal(route('file=service').topic, 'overview');
  assert.equal(route('file=rules').topic, 'delivery');
  assert.equal(route('file=tests').topic, 'tests');
  for (const topic of ['__proto__', 'constructor', '<script>']) {
    assert.equal(route({ topic }).topic, 'overview');
  }
  const html = logicView(route({ rule: '"><img src=x onerror=alert(1)>' }), topics);
  assert.match(html, /Правило не найдено/);
  assert.doesNotMatch(html, /<img/);
});

test('highlighting escapes hostile text and preserves all characters and balanced multiline markup', async () => {
  const decode = html => html.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#39);/g,
    value => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[value]);
  for (const input of [
    'const message = "<img src=x onerror=alert(1)>";\n// <script> &\n/* multi\nline */',
    'const text = `line one\nline two ${42}`;\nreturn true;',
    (await readSource('delivery')).content,
    logicText((await getLogicGuide()).topics, 'delivery'),
  ]) {
    const html = highlight(input);
    assert.equal(decode(html), input);
    assert.doesNotMatch(html, /<(?:img|script)\b/);
    for (const line of html.split('\n')) {
      assert.equal((line.match(/<span /g) ?? []).length, (line.match(/<\/span>/g) ?? []).length);
    }
  }
  assert.match(highlight('ЕСЛИ CRM.завершено = ДА', 'pseudo'), /syntax-keyword/);
  assert.equal(highlight('<text>', 'text'), '&lt;text&gt;');
});
