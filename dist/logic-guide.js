export function topicForRule(topics, id) {
  return Object.keys(topics).find(key => topics[key].rules?.some(rule => rule.id === id));
}

export function branchText(rule, index) {
  const condition = `${index ? 'Иначе, если' : 'Если'} ${rule.condition}`;
  return `${condition}${condition.includes('\n') ? '' : ':'}\n` +
    `Тогда: ${priorityText(rule.priority)}.` +
    (rule.action ? `\nДействие: ${rule.action}` : '');
}

export function priorityText(priority) {
  return {
    'СЕЙЧАС': 'проверить сейчас',
    'СЕГОДНЯ': 'решить сегодня',
    'ДО СРОКА': 'решить до наступления срока',
    'БЕЗ ДЕЙСТВИЙ': 'отдельная задача не нужна',
    'ПО СРОКУ': 'определить по сроку операции',
  }[priority] ?? priority;
}

export function logicText(topics, key) {
  const topic = topics[key];
  return [topic.name, topic.note, topic.code,
    ...(topic.groups ?? []).map(group => group.name + '\n' + group.rules.map((rule, index) =>
      `${index + 1}. ${rule.title}\n${branchText(rule, index)}\n${rule.source.url}`
    ).join('\n\n')),
    ...(topic.rules ?? []).map((rule, index) => `${branchText(rule, index)}\n  // ${rule.id}\n  // ${rule.source.url}`),
  ].filter(Boolean).join('\n\n');
}
