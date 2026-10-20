import { RULE_SETS, RULES_VERSION } from '../domain/rules.js';
import { dataRules } from '../domain/rules/data.js';
import { deadlineRules } from '../domain/rules/deadline.js';
import { describeRule } from '../domain/rule-engine.js';
import { readSource, ruleSource, SOURCE_REVISION } from './source-files.js';

// Only navigation and context live here. Conditions and outcomes come from the engine.
const SECTIONS = {
  overview: {
    name: 'Весь процесс', file: 'rules',
    input: 'Снимок CRM, сообщения и время оценки',
    output: 'Очередь с причиной, проверкой и следующим шагом',
    note: 'Для каждого случая применяется первое совпадение. Сводка предлагает действия; подтверждения и сообщения остаются за сотрудником.',
  },
  delivery: {
    name: 'Поставка', file: 'delivery', example: 'П-08',
    input: 'Приёмка в CRM + сообщение получателя или курьера',
    output: 'Проверка, приоритет и следующее действие',
    note: 'Правила исполняются сверху вниз. После первого совпадения остальные ветки не проверяются.',
  },
  onboarding: {
    name: 'Приём сотрудника', file: 'onboarding', example: 'С-17',
    input: 'Статус документов + сообщение + дата первого выхода',
    output: 'Проверка, приоритет и следующее действие',
    note: 'Условия и действия ниже получены из того же определения, которое использует расчёт.',
  },
  offboarding: {
    name: 'Увольнение', file: 'offboarding', example: 'С-24',
    input: 'Согласование руководителя + завершение процедуры',
    output: 'Проверка, приоритет и следующее действие',
    note: 'Условия и действия ниже получены из того же определения, которое использует расчёт.',
  },
  priority: {
    name: 'Сроки и приоритет', file: 'priority',
    input: 'Плановый срок + время снимка',
    output: 'Сейчас / сегодня / до срока',
    note: 'Эти правила вычисляют «По сроку». ДЕНЬ_МСК берёт календарный день по Москве; МОМЕНТ сравнивает точное время. Неизвестное время не задаёт порядок событий.',
  },
  validation: {
    name: 'Качество данных', file: 'data',
    input: 'Время событий и снимка',
    output: 'Продолжить расчёт или сначала проверить даты',
    note: 'Эта проверка идёт перед правилами каждого случая. Контракт полей и формата дат проверяется ещё до неё.',
  },
  tests: {
    name: 'Примеры проверок', file: 'tests',
    input: 'Сценарии из автоматических тестов',
    output: 'Проверка поведения правил',
    note: 'Названия прочитаны из исполняемого файла тестов. Полный набор: npm run check.',
  },
  prompt: {
    name: 'Извлечение фактов', file: 'prompt',
    input: 'Сообщения и ссылки на источники',
    output: 'Факты для правил',
    note: 'Контракт будущей интеграции. В демо сигналы заданы вручную; модель не вызывается.',
  },
};

export async function getLogicGuide() {
  const topics = structuredClone(SECTIONS);
  const groups = { ...RULE_SETS, priority: deadlineRules, validation: dataRules };
  await Promise.all(Object.entries(topics).map(async ([key, topic]) => {
    const source = await readSource(topic.file);
    topic.source = { path: source.path, url: source.githubUrl, revision: source.revision };
    if (groups[key]) {
      topic.rules = groups[key].map(rule => ({ ...describeRule(rule), source: ruleSource(source, rule.id) }));
    }
    if (key === 'tests') {
      topic.code = [...source.content.matchAll(/test\("([^"]+)"/g)].map(([, title]) => 'ПРОВЕРИТЬ ' + title).join('\n');
    }
    if (key === 'prompt') topic.code = source.content;
  }));
  topics.overview.code = Object.entries(RULE_SETS).map(([kind, rules]) =>
    `ДЛЯ «${topics[kind].name}»:\n` +
    dataRules.map(rule => `  ПРОВЕРИТЬ ${rule.id}`).join('\n') +
    `\n  ВЫБРАТЬ первое совпадение из ${rules.length} правил` +
    '\n  ВЕРНУТЬ приоритет, проверку и действие'
  ).join('\n\n');
  return { topics, rulesVersion: RULES_VERSION, revision: SOURCE_REVISION };
}
