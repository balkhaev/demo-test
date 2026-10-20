import assert from 'node:assert/strict';
import test from 'node:test';
import { getLogicGuide } from '../server/logic-guide.js';
import { readSource } from '../server/source-files.js';
import { logicText, topicForRule, branchText } from '../dist/logic-guide.js';
import { logicRoute, logicView } from '../dist/logic-view.js';
import { highlight } from '../dist/highlight.js';
import { RULE_SETS, evaluateCase } from '../domain/rules.js';
import { dataRules } from '../domain/rules/data.js';
import { deadlineRules } from '../domain/rules/deadline.js';
import { eq, field, before, instant, evaluate, describe, not, all, any } from '../domain/expressions.js';
import { conditionView } from '../domain/rule-language.js';
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
    assert.equal(generated.condition, 'в сообщении говорится о получении');
    assert.equal(generated.action, result.action);
    assert.equal(generated.check, result.check);
    assert.deepEqual(generated.closureConditions, result.closureConditions);
    const html = logicView(logicRoute(new URLSearchParams({ rule: definition.id }), topics), topics);
    assert.match(html.replace(/<[^>]*>/g, ''), /Проверить изменённое правило/);
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
  assert.equal(describe(condition), 'сообщение датировано раньше приёмки');
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
  assert.match(logicView(route(''), topics), /первое подходящее даёт решение/);
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

test('every displayed business condition uses ordinary Russian without code notation', async () => {
  const { topics } = await getLogicGuide();
  for (const topic of Object.values(topics)) {
    for (const [index, rule] of (topic.rules ?? []).entries()) {
      assert.doesNotMatch(branchText(rule, index), /МОМЕНТ|ДЕНЬ_МСК|ПЕРВОЕ_ИЗВЕСТНОЕ|НЕ\s*\(|(?:crm|CRM|сообщение)\.[\p{L}_]|[<>=]/u);
      assert.match(branchText(rule, index), /[^\n]\nТогда: [^\n]+\.(?:\nДействие: |$)/);
    }
  }
  const incomplete = topics.delivery.rules.find(rule => rule.id === 'DELIVERY.CONFIRMED');
  assert.match(incomplete.condition, /время приёмки указано/);
  assert.match(topics.onboarding.rules[0].condition, /нехватке документов/);
  assert.match(topics.offboarding.rules[1].condition, /отсутствует или неизвестно/);
  assert.match(topics.priority.rules[1].condition, /ни дата срока, ни его точное время/);
});

test('simplified time wording retains equal, later and unknown cases instead of treating them as later', () => {
  const condition = not(before(instant(field('message.occurredAt')), instant(field('crm.receivedAt'))));
  assert.equal(describe(condition), 'сообщение датировано одновременно с приёмкой или позже, либо время одного из событий неизвестно');
  const item = structuredClone(SAMPLE.cases.find(value => value.id === 'П-09'));
  for (const [message, receipt, expected] of [
    ['2026-10-19T06:19:59Z', '2026-10-19T09:20:00+03:00', false],
    ['2026-10-19T06:20:00Z', '2026-10-19T09:20:00+03:00', true],
    ['2026-10-19T06:20:01Z', '2026-10-19T09:20:00+03:00', true],
    [null, '2026-10-19T09:20:00+03:00', true],
    ['2026-10-19T06:20:00Z', null, true],
    [null, null, true],
  ]) {
    item.message.occurredAt = message;
    item.crm.receivedAt = receipt;
    assert.equal(evaluate(condition, item), expected);
  }
  assert.equal(describe(not(condition)), 'сообщение датировано раньше приёмки');
});

test('nested negation and AND/OR edits generate correctly grouped positive wording', () => {
  const approval = eq(field('crm.managerApproved'), true);
  const missing = eq(field('message.signal'), 'missing');
  const condition = not(all(approval, missing));
  const view = conditionView(condition);
  assert.equal(view.mode, 'any');
  assert.deepEqual(view.items.map(item => item.text), [
    'подтверждение руководителя в CRM отсутствует или неизвестно',
    'в сообщении нет сведений о недостаче',
  ]);
  const mixed = conditionView(all(approval, any(missing, not(approval))));
  assert.equal(mixed.mode, 'all');
  assert.equal(mixed.items[1].mode, 'any');
  assert.equal(describe(not(not(approval))), 'в CRM есть подтверждение руководителя');
  const context = { crm: { managerApproved: null }, message: { signal: 'missing' } };
  for (const value of [true, false, null]) {
    context.crm.managerApproved = value;
    assert.equal(evaluate(condition, context), value !== true);
    assert.equal(evaluate(not(not(approval)), context), value === true);
  }
  assert.match(describe(all(approval, missing)), /^выполнены все условия/);
  assert.match(describe(any(approval, missing)), /^выполнено хотя бы одно условие/);
});

test('overview lists each real rule in order with a working link and follows roster edits', async () => {
  const verify = async () => {
    const { topics } = await getLogicGuide();
    const html = logicView(logicRoute(new URLSearchParams(), topics), topics);
    assert.doesNotMatch(html, /ВЫБРАТЬ|из \d+ правил/);
    assert.doesNotMatch(html, /Сначала — проверить время данных|Подробнее об этой проверке|DATA\.FUTURE_SOURCE/);
    assert.doesNotMatch(logicText(topics, 'overview'), /Сначала для любого случая|Исправить время или пересчитать/);
    for (const group of topics.overview.groups) {
      assert.deepEqual(group.rules.map(rule => rule.id), RULE_SETS[group.key].map(rule => rule.id));
      for (const rule of group.rules) {
        assert.ok(html.includes(`href="#/logic?rule=${rule.id}"`));
        assert.ok(html.includes(rule.title));
        assert.equal(topicForRule(topics, rule.id), group.key);
        assert.ok(logicText(topics, 'overview').includes(rule.action));
      }
    }
    return topics.overview.groups[0];
  };
  assert.equal((await verify()).rules.length, 7);
  const original = RULE_SETS.delivery;
  try {
    RULE_SETS.delivery = original.slice(1).reverse();
    assert.equal((await verify()).rules.length, 6);
  } finally {
    RULE_SETS.delivery = original;
  }
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
