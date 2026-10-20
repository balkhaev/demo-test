import { topicForRule, branchText, priorityText } from './logic-guide.js?v=6';
import { highlight } from './highlight.js?v=6';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function logicRoute(params, topics = {}) {
  const rule = params.get('rule');
  const legacy = { rules: 'delivery', service: 'overview' };
  const requested = params.get('topic') ?? legacy[params.get('file')] ?? params.get('file');
  const topic = topicForRule(topics, rule) ?? (Object.hasOwn(topics, requested) ? requested : 'overview');
  return { name: 'logic', topic, file: topics[topic]?.file, rule, source: params.get('view') === 'source' };
}

function topicUrl(current, source) {
  const params = new URLSearchParams({ topic: current.topic });
  if (current.rule) params.set('rule', current.rule);
  if (source) params.set('view', 'source');
  return '#/logic?' + params;
}

function ruleCard(rule, index, current) {
  const { id, title, check, closureConditions, source } = rule;
  const selected = current.rule === id;
  return `<article class="logic-rule ${selected ? 'selected-rule' : ''}" ${selected ? 'id="selected-rule" tabindex="-1"' : ''}>
    <div class="rule-step">${String(index + 1).padStart(2, '0')}</div>
    <div class="rule-body"><h3>${escape(title)}</h3>
    <pre class="rule-code">${highlight(branchText(rule, index), 'pseudo')}</pre>
    ${check ? `<details class="rule-details"><summary>Проверка и условия закрытия</summary><p>${escape(check)}</p><ul>${closureConditions.map(text => `<li>${escape(text)}</li>`).join('')}</ul></details>` : ''}
    <div class="rule-links"><a class="rule-permalink" href="#/logic?rule=${encodeURIComponent(id)}">${escape(id)}</a>
    <a href="#/logic?rule=${encodeURIComponent(id)}&view=source">Исходник</a>
    <a href="${escape(source.url)}" target="_blank" rel="noopener">GitHub · L${source.line}–${source.endLine} ↗</a>
    ${selected ? '<span class="rule-selected-label">Из выбранного случая</span>' : ''}</div></div></article>`;
}

function overviewView(topic) {
  return `<div class="logic-overview">
    <section class="overview-preflight"><h3>Сначала — проверить время данных</h3>
      <p>Для любого случая, до проверки поставки, приёма или увольнения:</p>
      ${topic.preflight.map(rule => `<pre class="rule-code overview-condition">${highlight(branchText(rule, 0), 'pseudo')}</pre>
        <a href="#/logic?rule=${encodeURIComponent(rule.id)}">Подробнее об этой проверке →</a>`).join('')}
    </section>
    <p class="overview-instruction">Если даты в порядке, выбираем вид случая. Проверяем правила по порядку: первое подходящее даёт решение, следующие уже не нужны.</p>
    ${topic.groups.map(group => `<section class="overview-group">
      <h3><a href="#/logic?topic=${group.key}">${escape(group.name)}</a> <span>${group.rules.length} ${group.rules.length === 4 ? 'правила' : 'правил'}</span></h3>
      <ol>${group.rules.map(rule => `<li>
        <a href="#/logic?rule=${encodeURIComponent(rule.id)}">${escape(rule.title)} <span aria-hidden="true">→</span></a>
        <span class="overview-outcome">${escape(priorityText(rule.priority))}</span>
      </li>`).join('')}</ol>
    </section>`).join('')}
  </div>`;
}

export function logicView(current, topics) {
  const topic = topics[current.topic];
  return `<section aria-labelledby="page-title">
    <div class="heading-row"><div><div class="eyebrow">Как принимается решение</div>
    <h1 id="page-title">Логика простыми шагами</h1>
    <p class="subtitle">Псевдокод и расчёт используют одни определения правил.</p></div>
    <div class="heading-actions"><a class="btn" href="https://github.com/balkhaev/demo-test" target="_blank" rel="noopener">GitHub ↗</a>
    <a class="btn" href="https://github.com/balkhaev/demo-test/archive/refs/heads/main.zip">Скачать проект ↓</a></div></div>
    <div class="logic-flow" aria-label="Порядок обработки">
      <div><span>01</span><strong>Проверить данные</strong><p>Факты и время снимка</p></div>
      <div><span>02</span><strong>Выбрать правило</strong><p>Первое совпадение</p></div>
      <div><span>03</span><strong>Собрать очередь</strong><p>Причина и следующий шаг</p></div>
      <div><span>04</span><strong>Проверить человеком</strong><p>Подтвердить и действовать</p></div>
    </div>
    <div class="business-code-layout">
      <nav class="file-nav" aria-label="Разделы логики">${Object.entries(topics).map(([key, entry]) =>
        `<a href="#/logic?topic=${key}" class="${key === current.topic ? 'active' : ''}" ${key === current.topic ? 'aria-current="page"' : ''}>${entry.name}<span>→</span></a>`).join('')}</nav>
      <div class="source-view">
        <div class="source-description"><h2>${escape(topic.name)}</h2><p>${escape(topic.note)}</p>
        <dl><div><dt>Вход</dt><dd>${escape(topic.input)}</dd></div><div><dt>Выход</dt><dd>${escape(topic.output)}</dd></div></dl>
        <a class="source-github" href="${escape(topic.source.url)}" target="_blank" rel="noopener">${escape(topic.source.path)} ↗ GitHub</a>
        <span class="source-revision">${topic.source.revision === 'main' ? 'Ветка main' : 'Версия ' + escape(topic.source.revision.slice(0, 7))}</span></div>
        <nav class="logic-modes" aria-label="Представление логики">
          <a href="${escape(topicUrl(current, false))}" ${!current.source ? 'aria-current="page"' : ''}>Псевдокод</a>
          <a href="${escape(topicUrl(current, true))}" ${current.source ? 'aria-current="page"' : ''}>${current.file === 'prompt' ? 'Текст контракта' : 'Исходник JavaScript'}</a>
        </nav>
        ${current.rule && !topicForRule(topics, current.rule) ? '<p class="notice" role="status">Правило не найдено. Выберите раздел слева.</p>' : ''}
        ${current.source ? sourceView() : `<div class="pseudocode-panel">
          <div class="pseudo-toolbar"><span>${topic.rules ? 'Из исполняемых правил' : 'Логика'} · ${escape(topic.name)}</span><button data-action="copy-logic">Копировать</button></div>
          ${topic.code ? `<pre class="pseudocode" tabindex="0" aria-label="Псевдокод">${highlight(topic.code, current.topic === 'prompt' ? 'text' : 'pseudo')}</pre>` : ''}
          ${topic.groups ? overviewView(topic) : ''}
          ${(topic.rules ?? []).map((rule, index) => ruleCard(rule, index, current)).join('')}
        </div>
        ${topic.example ? '<p class="logic-footnote">Перед этими правилами: <a href="#/logic?rule=DATA.FUTURE_SOURCE">проверка времени источников</a>. «По сроку»: <a href="#/logic?topic=priority">как определяется приоритет</a>.</p>' : ''}`}
        <div class="logic-next">${topic.example ? `<a class="btn btn-primary" href="#/cases/${encodeURIComponent(topic.example)}">Проверить на случае ${topic.example} →</a>` : '<a class="btn btn-primary" href="#/summary">Посмотреть сводку →</a>'}
        ${current.rule && topicForRule(topics, current.rule) ? '<button class="btn" data-action="find-rule">К выбранному правилу ↓</button>' : ''}</div>
      </div>
    </div>
    <p class="quick-tip">Условия, приоритеты, действия и проверки формируются из исполняемых определений. Для закрытого репозитория GitHub нужен аккаунт с доступом. CRM, чаты и ИИ в демо не подключены.</p>
  </section>`;
}

function sourceView() {
  return `<div class="code-box"><div class="code-bar"><span id="source-path">Загрузка исходника…</span>
    <div class="code-actions"><button data-action="copy-code" disabled>Копировать</button><button data-action="download-code" disabled>Скачать ↓</button></div></div>
    <pre class="code-content numbered-code" id="code-content" tabindex="0" aria-label="Исходный код" aria-busy="true">Получаем файл с сервера…</pre></div>`;
}
