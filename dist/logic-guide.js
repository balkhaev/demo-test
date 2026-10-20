export function topicForRule(topics, id) {
  return Object.keys(topics).find(key => topics[key].rules?.some(rule => rule.id === id));
}

export function branchText(rule, index) {
  const condition = rule.condition === 'ИНАЧЕ'
    ? 'ИНАЧЕ' : `${index ? 'ИНАЧЕ ЕСЛИ' : 'ЕСЛИ'} ${rule.condition}`;
  return `${condition}:\n  ПРИОРИТЕТ ${rule.priority}` +
    (rule.action ? `\n  ДЕЙСТВИЕ ${JSON.stringify(rule.action)}` : '');
}

export function logicText(topics, key) {
  const topic = topics[key];
  return [topic.name, topic.note, topic.code,
    ...(topic.rules ?? []).map((rule, index) => `${branchText(rule, index)}\n  // ${rule.id}\n  // ${rule.source.url}`),
  ].filter(Boolean).join('\n\n');
}
