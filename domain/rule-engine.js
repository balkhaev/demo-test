import { evaluate, describe } from './expressions.js';

export const PRIORITY_NAMES = {
  urgent: 'СЕЙЧАС', today: 'СЕГОДНЯ', 'before-start': 'ДО СРОКА',
  done: 'БЕЗ ДЕЙСТВИЙ', deadline: 'ПО СРОКУ',
};

/** First match wins. The trace contains only conditions actually evaluated. */
export function selectRule(rules, context, trace = []) {
  for (const rule of rules) {
    const matched = Boolean(evaluate(rule.when, context));
    trace.push({
      ruleId: rule.id, title: rule.title, matched,
      sourceIds: (rule.sourceKeys ?? []).map(key => context.sources[key].id),
    });
    if (matched) return rule;
  }
  throw new Error('Domain rules must include a fallback');
}

export function resolveDecision(rule, item, asOf, deadlinePriority) {
  const definition = rule.then;
  return {
    ...definition,
    priority: definition.priority === 'deadline' ? deadlinePriority(item, asOf) : definition.priority,
    reason: typeof definition.reason === 'function' ? definition.reason({ item, asOf }) : definition.reason,
    closureConditions: [...definition.closureConditions],
    ruleId: rule.id,
  };
}

/** No parallel condition/action descriptions: render the executable definition. */
export function describeRule(rule) {
  return {
    id: rule.id,
    title: rule.title,
    condition: rule.when === true ? 'ИНАЧЕ' : describe(rule.when),
    priority: PRIORITY_NAMES[rule.then.priority],
    action: rule.then.action ?? '',
    check: rule.then.check ?? '',
    closureConditions: rule.then.closureConditions ?? [],
  };
}
