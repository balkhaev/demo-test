import { topics, topicForRule } from './logic-guide.js?v=4';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function logicRoute(params) {
  const rule = params.get('rule');
  const legacy = { rules: 'delivery', service: 'overview' };
  const requested = params.get('topic') ?? legacy[params.get('file')] ?? params.get('file');
  const topic = topicForRule(rule) ?? (Object.hasOwn(topics, requested) ? requested : 'overview');
  return { name: 'logic', topic, file: rule === 'DATA.FUTURE_SOURCE' ? 'rules' : topics[topic].file, rule, source: params.get('view') === 'source' };
}

function topicUrl(current, source) {
  const params = new URLSearchParams({ topic: current.topic });
  if (current.rule) params.set('rule', current.rule);
  if (source) params.set('view', 'source');
  return '#/logic?' + params;
}

function ruleCard([id, condition, outcome, note], index, current) {
  const selected = current.rule === id;
  return `<article class="logic-rule ${selected ? 'selected-rule' : ''}" ${selected ? 'id="selected-rule" tabindex="-1"' : ''}>
    <div class="rule-step">${String(index + 1).padStart(2, '0')}</div>
    <div><p class="rule-condition"><span>${index ? 'ИНАЧЕ ЕСЛИ' : 'ЕСЛИ'}</span> ${escape(condition)}</p>
    <p class="rule-outcome"><span>ТО</span> ${escape(outcome)}</p>
    ${note ? `<p class="rule-note">${escape(note)}</p>` : ''}
    <a class="rule-permalink" href="#/logic?rule=${encodeURIComponent(id)}">${escape(id)}</a>
    ${selected ? '<span class="rule-selected-label">Из выбранного случая</span>' : ''}</div></article>`;
}

export function logicView(current) {
  const topic = topics[current.topic];
  return `<section aria-labelledby="page-title">
    <div class="heading-row"><div><div class="eyebrow">Как принимается решение</div>
    <h1 id="page-title">Логика простыми шагами</h1>
    <p class="subtitle">Псевдокод: какие факты проверяем, какое решение принимаем и почему.</p></div>
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
        <div class="source-description"><h2>${topic.name}</h2><p>${topic.note}</p>
        <dl><div><dt>Вход</dt><dd>${topic.input}</dd></div><div><dt>Выход</dt><dd>${topic.output}</dd></div></dl></div>
        <nav class="logic-modes" aria-label="Представление логики">
          <a href="${escape(topicUrl(current, false))}" ${!current.source ? 'aria-current="page"' : ''}>Псевдокод</a>
          <a href="${escape(topicUrl(current, true))}" ${current.source ? 'aria-current="page"' : ''}>${current.file === 'prompt' ? 'Текст контракта' : 'Исходник JavaScript'}</a>
        </nav>
        ${current.rule && !topicForRule(current.rule) ? '<p class="notice" role="status">Правило не найдено. Выберите раздел слева.</p>' : ''}
        ${current.source ? sourceView() : `<div class="pseudocode-panel">
          <div class="pseudo-toolbar"><span>Логика · ${topic.name}</span><button data-action="copy-logic">Копировать псевдокод</button></div>
          ${topic.code ? `<pre class="pseudocode" tabindex="0" aria-label="Псевдокод">${escape(topic.code)}</pre>` : ''}
          ${(topic.rules ?? []).map((rule, index) => ruleCard(rule, index, current)).join('')}
        </div>
        ${topic.rules && current.topic !== 'validation' ? '<p class="logic-footnote">Перед этими правилами: <a href="#/logic?rule=DATA.FUTURE_SOURCE">проверка времени источников</a>. «По сроку»: <a href="#/logic?topic=priority">как определяется приоритет</a>.</p>' : ''}`}
        <div class="logic-next">${topic.example ? `<a class="btn btn-primary" href="#/cases/${encodeURIComponent(topic.example)}">Проверить на случае ${topic.example} →</a>` : '<a class="btn btn-primary" href="#/summary">Посмотреть сводку →</a>'}
        ${current.rule && topicForRule(current.rule) ? '<button class="btn" data-action="find-rule">К выбранному правилу ↓</button>' : ''}</div>
      </div>
    </div>
    <p class="quick-tip">Псевдокод объясняет правила. Расчёт выполняет сервер; исходники доступны во второй вкладке. CRM, чаты и ИИ в демо не подключены.</p>
  </section>`;
}

function sourceView() {
  return `<div class="code-box"><div class="code-bar"><span id="source-path">Загрузка исходника…</span>
    <div class="code-actions"><button data-action="copy-code" disabled>Копировать</button><button data-action="download-code" disabled>Скачать ↓</button></div></div>
    <pre class="code-content numbered-code" id="code-content" tabindex="0" aria-label="Исходный код" aria-busy="true">Получаем файл с сервера…</pre></div>`;
}
