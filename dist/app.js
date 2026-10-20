import { SAMPLE } from './data.js';
import { buildSummary } from './engine.js';

let cases = structuredClone(SAMPLE.cases);
let results = buildSummary(cases);
let activeFilter = 'all';
let selectedFile = 'engine.js';
let renderVersion = 0;
let loadedCode = null;
let toastTimer;

const main = document.querySelector('main');
const bundledSources = globalThis.__DEMO_SOURCES__;
const downloadUrls = new Map();
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const priorityNames = { urgent: 'Сейчас', today: 'Сегодня', 'before-start': 'До выхода', done: 'В порядке' };
const sourceFiles = {
  'engine.js': ['Правила', 'Та же функция, которая рассчитывает сводку на первом экране.'],
  'data.js': ['Данные', 'Исходный набор из четырёх случаев. Изменения в демо хранятся только в текущей вкладке.'],
  'prompt.txt': ['Промпт для ИИ', 'Контракт извлечения фактов из переписки. В этом демо модель не вызывается.'],
  'app.js': ['Интерфейс', 'Состояние, сценарии и отображение. Обычный JavaScript, без зависимостей.'],
};
const messageScenarios = {
  received: { author: 'Получатель', text: 'Карты получили, количество проверили', signal: 'received', notBefore: null },
  missing: { author: 'Получатель', text: 'При повторной проверке обнаружили недостачу карт', signal: 'missing', notBefore: null },
  delay: { author: 'Курьер', text: 'Задерживаюсь, раньше 13:00 не приеду', signal: 'delay', notBefore: '13:00' },
};
const copyIcon = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="7" y="7" width="9" height="10" rx="1.5"/><path d="M12 7V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3"/></svg>';

function itemChanged(item) {
  const previous = results.find(result => result.id === item.id);
  return JSON.stringify([item.crm, item.message]) !== JSON.stringify([previous.crm, previous.message]);
}

function isDirty() {
  return cases.some(itemChanged);
}

function downloadUrl(file) {
  if (!bundledSources) return file === 'project.zip'
    ? 'https://github.com/balkhaev/demo-test/archive/refs/heads/main.zip'
    : file;
  if (!downloadUrls.has(file)) {
    const content = file === 'project.zip'
      ? Uint8Array.from(atob(globalThis.__DEMO_ARCHIVE__), character => character.charCodeAt(0))
      : bundledSources[file];
    downloadUrls.set(file, URL.createObjectURL(new Blob([content], {
      type: file.endsWith('.zip') ? 'application/zip' : 'text/plain;charset=utf-8',
    })));
  }
  return downloadUrls.get(file);
}

function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('visible'), 2600);
}

function crmFacts(item) {
  if (item.kind === 'onboarding') return {
    title: { pending: 'Документы ожидаются', incomplete: 'Комплект неполный', accepted: 'Документы приняты' }[item.crm.documents],
    detail: item.crm.documents === 'accepted' ? 'Приём документов зафиксирован' : 'Полный комплект не подтверждён',
    ok: item.crm.documents === 'accepted',
  };
  if (item.kind === 'offboarding') return {
    title: item.crm.managerApproved ? 'Согласование есть' : 'Нет согласования руководителя',
    detail: item.crm.completed ? 'Процедура отмечена завершённой' : 'Процедура не завершена',
    ok: item.crm.managerApproved,
  };
  return {
    title: item.crm.completed ? 'Принято' : item.crm.status,
    detail: item.crm.receivedAt ? `Приёмка в ${item.crm.receivedAt}` : 'Приёмка не подтверждена',
    ok: item.crm.completed && Boolean(item.crm.receivedAt),
  };
}

function crmDescription(item) {
  const facts = crmFacts(item);
  return `${item.deadlineLabel}. ${facts.title}. ${facts.detail}.`;
}

function taskText(item) {
  return `${item.id} — ${item.title} · ${item.statusLabel}\nCRM: ${crmDescription(item)}\nПереписка (${item.message.author}): «${item.message.text}»\nВывод: ${item.reason}\nПроверить: ${item.check}\nДействие: ${item.action}`;
}

function dirtyNotice() {
  return isDirty() ? '<div class="notice" role="status"><span>Данные изменены. Сводка пока показывает предыдущий расчёт.</span><button data-action="run">Пересчитать →</button></div>' : '';
}

function caseRow(item) {
  const facts = crmFacts(item);
  return `<tr class="case-row ${item.priority}">
    <td class="case-cell">
      <div class="case-top"><span class="case-id">${escapeHtml(item.id)}</span><span class="priority ${item.priority}" title="${escapeHtml(item.statusLabel)}">${priorityNames[item.priority]}</span></div>
      <h2 class="case-title">${escapeHtml(item.title)}</h2>
      <p class="deadline">${escapeHtml(item.deadlineLabel)}</p>
    </td>
    <td class="source-cell" data-label="CRM">
      <strong class="source-status ${facts.ok ? 'ok' : 'warn'}">${escapeHtml(facts.title)}</strong>
      <p class="source-detail">${escapeHtml(facts.detail)}</p>
    </td>
    <td class="source-cell" data-label="Переписка">
      <span class="message-author">${escapeHtml(item.message.author)}</span>
      <p class="message-text">«${escapeHtml(item.message.text)}»</p>
    </td>
    <td class="action-cell">
      <div class="action-head"><p class="action-text">${escapeHtml(item.action)}</p><button class="icon-button" data-copy-case="${escapeHtml(item.id)}" aria-label="Копировать задачу ${escapeHtml(item.id)}" title="Копировать задачу">${copyIcon}</button></div>
      <details class="reason"><summary>Почему и что проверить</summary><p>${escapeHtml(item.reason)}</p><p><strong>Проверить:</strong> ${escapeHtml(item.check)}</p></details>
    </td>
  </tr>`;
}

function summaryView() {
  const active = results.filter(item => item.needsAttention);
  const shown = results.filter(item => activeFilter === 'all' || (activeFilter === 'attention' ? item.needsAttention : !item.needsAttention));
  const filters = [['all', 'Все', results.length], ['attention', 'Требуют внимания', active.length], ['done', 'Без действий', results.length - active.length]];
  const next = active.length ? `Начать с ${escapeHtml(active[0].id)}.` : 'Все случаи проверены. Действий не требуется.';
  return `<section aria-labelledby="page-title">
    <div class="heading-row"><div><h1 id="page-title">Сводка поддержки</h1><p class="subtitle">${escapeHtml(SAMPLE.snapshot.label)} · Снимок демо-данных</p></div><div class="heading-actions"><button class="btn" data-action="copy-summary">Копировать сводку</button><button class="btn btn-primary" data-action="run"><span class="refresh-icon" aria-hidden="true">↻</span> Обновить</button></div></div>
    ${dirtyNotice()}
    <div class="board">
      <div class="board-toolbar"><div class="filters" role="group" aria-label="Фильтр случаев">${filters.map(([value, label, count]) => `<button class="filter ${activeFilter === value ? 'active' : ''}" data-filter="${value}" aria-pressed="${activeFilter === value}">${label} <span>${count}</span></button>`).join('')}</div><span class="sort-label">По приоритету ↓</span></div>
      <table class="case-table" aria-label="Случаи поддержки"><thead><tr><th scope="col">Случай и срок</th><th scope="col">В CRM</th><th scope="col">В переписке</th><th scope="col">Следующий шаг</th></tr></thead><tbody>${shown.map(caseRow).join('') || '<tr><td class="empty" colspan="4">В этой группе пока нет случаев.</td></tr>'}</tbody></table>
      <div class="board-footer"><span><strong>${next}</strong>${active.length > 1 ? ' Затем — остальные задачи по приоритету.' : ''}</span><span>Сообщение в чате не заменяет подтверждение в CRM.</span></div>
    </div>
    <p class="quick-tip">Проверьте другой сценарий: <a href="#data">измените данные</a> и пересчитайте сводку.</p>
  </section>`;
}

function dataCard(item) {
  const id = escapeHtml(item.id);
  let controls;
  if (item.kind === 'onboarding') {
    controls = `<div class="field"><label for="documents-${id}">Документы</label><select id="documents-${id}" data-field="documents" data-id="${id}">${[['pending', 'Ожидаются'], ['incomplete', 'Неполный комплект'], ['accepted', 'Приняты']].map(([value, label]) => `<option value="${value}" ${item.crm.documents === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>`;
  } else if (item.kind === 'offboarding') {
    controls = `<div class="field"><label><input type="checkbox" data-id="${id}" data-field="managerApproved" ${item.crm.managerApproved ? 'checked' : ''}>Согласовано руководителем</label></div><div class="field"><label><input type="checkbox" data-id="${id}" data-field="completed" ${item.crm.completed ? 'checked' : ''}>Процедура завершена</label></div>`;
  } else {
    controls = `<div class="field"><label for="delivery-${id}">Приёмка</label><select id="delivery-${id}" data-id="${id}" data-field="received"><option value="no" ${!item.crm.completed ? 'selected' : ''}>Не подтверждена</option><option value="yes" ${item.crm.completed ? 'selected' : ''}>Подтверждена</option></select></div>`;
  }
  const messageControl = item.kind === 'delivery'
    ? `<div class="field"><label for="message-${id}">Сообщение</label><select id="message-${id}" data-id="${id}" data-field="message">${[['delay', 'Курьер задерживается'], ['received', 'Карты получены'], ['missing', 'Обнаружена недостача']].map(([value, label]) => `<option value="${value}" ${item.message.signal === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>`
    : '';
  return `<article class="data-card"><div class="case-top"><span class="case-id">${id}</span><h2 class="case-title">${escapeHtml(item.title)}</h2>${itemChanged(item) ? '<span class="edited-label">Изменено</span>' : ''}</div><p class="deadline">${escapeHtml(item.deadlineLabel)}</p><div class="data-columns"><div><h3 class="mini-title">CRM</h3>${controls}</div><div><h3 class="mini-title">Переписка</h3>${messageControl}<div class="message-preview"><span class="message-author">${escapeHtml(item.message.author)}</span>«${escapeHtml(item.message.text)}»</div></div></div></article>`;
}

function dataView() {
  return `<section aria-labelledby="page-title">
    <div class="heading-row"><div><h1 id="page-title">Исходные данные</h1><p class="subtitle">Измените факты в CRM или сообщение. Сводка покажет, что поменялось.</p></div><div class="heading-actions"><button class="btn" data-action="reset">Сбросить</button><button class="btn btn-primary" data-action="run">Применить и открыть сводку →</button></div></div>
    ${dirtyNotice()}<div class="data-grid">${cases.map(dataCard).join('')}</div>
    <p class="data-footnote">CRM и переписка меняются независимо. Сообщения размечены заранее, чтобы проверить правила. Изменения сохраняются до перезагрузки страницы.</p>
  </section>`;
}

function codeView() {
  return `<section aria-labelledby="page-title">
    <div class="heading-row"><div><h1 id="page-title">Код и логика</h1><p class="subtitle">Данные → проверяемые правила → приоритет и действие.</p></div><div class="heading-actions"><a class="btn" href="https://github.com/balkhaev/demo-test" target="_blank" rel="noopener">GitHub ↗</a><a class="btn btn-primary" href="project.zip" download>Скачать проект ↓</a></div></div>
    <div class="code-layout"><div><div class="code-tabs" role="group" aria-label="Файлы исходного кода">${Object.entries(sourceFiles).map(([file, [name]]) => `<button data-file="${file}" class="${selectedFile === file ? 'active' : ''}" aria-pressed="${selectedFile === file}">${name}</button>`).join('')}</div><div class="code-box"><div class="code-bar"><span>${selectedFile}</span><div class="code-actions"><button data-action="copy-code" disabled>Копировать</button><a href="${selectedFile}" download>Скачать ↓</a></div></div><pre class="code-content" id="code-content" tabindex="0" aria-label="Исходный код" aria-busy="true">Загрузка файла…</pre></div><p class="field-help">${sourceFiles[selectedFile][1]}</p></div>
    <aside class="code-side"><div class="explanation"><h2>Три важных различия</h2><ul><li>«Отправил» — ещё не принято.</li><li>«В курсе» — ещё не согласовано.</li><li>«Не раньше 13:00» — не точное время доставки.</li></ul></div><div class="explanation"><h2>Что работает</h2><p>Сортировка по приоритету, проверка расхождений, сценарии и копирование задач. Логика покрыта 11 тестами.</p><p style="margin-top:10px">В демо нет запросов к CRM или ИИ. В рабочей версии модель извлекает факты, правила определяют приоритет, человек подтверждает действие.</p></div></aside></div>
    <details class="launch"><summary>Как запустить в работе</summary><p>Каждый рабочий день в 10:00 получать разрешённую выгрузку CRM и связанные сообщения, сопоставлять их по ID дела. Для каждого вывода сохранять ссылки на источники; несопоставленные записи отправлять на ручную проверку. Перед действием проверять актуальность данных, дату сообщения и обязательные подтверждения.</p><p>Первую неделю сравнивать сводку с ручной проверкой. Разбирать пропуски и лишние тревоги, измерять время подготовки. Переходить к регулярной работе после подтверждения экономии времени без роста пропусков на проверенной выборке.</p></details>
  </section>`;
}

async function loadCode(version) {
  const file = selectedFile;
  try {
    let code = bundledSources?.[file];
    if (code === undefined) {
      const response = await fetch(`${file}?v=20261020-compact`);
      if (!response.ok) throw new Error('File unavailable');
      code = await response.text();
    }
    if (version !== renderVersion) return;
    loadedCode = code;
    const element = document.querySelector('#code-content');
    element.textContent = code;
    element.setAttribute('aria-busy', 'false');
    document.querySelector('[data-action="copy-code"]').disabled = false;
  } catch {
    if (version !== renderVersion) return;
    const element = document.querySelector('#code-content');
    element.textContent = 'Не удалось загрузить файл. Откройте его по ссылке «Скачать» или в GitHub.';
    element.setAttribute('aria-busy', 'false');
  }
}

function render(focusTarget) {
  const route = ['summary', 'data', 'code'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'summary';
  renderVersion += 1;
  loadedCode = null;
  for (const link of document.querySelectorAll('[data-nav]')) {
    link.classList.toggle('active', link.dataset.nav === route);
    if (link.dataset.nav === route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.querySelector('#nav-count').textContent = results.filter(item => item.needsAttention).length;
  document.querySelector('#change-dot').hidden = !isDirty();
  main.innerHTML = { summary: summaryView, data: dataView, code: codeView }[route]();
  for (const link of main.querySelectorAll('a[download]')) {
    const file = link.getAttribute('href');
    link.setAttribute('download', file);
    link.setAttribute('href', downloadUrl(file));
  }
  if (route === 'code') void loadCode(renderVersion);
  if (focusTarget) main.querySelector(focusTarget)?.focus({ preventScroll: true });
}

async function copyText(text, success) {
  try {
    await navigator.clipboard.writeText(text);
    toast(success);
  } catch {
    toast('Копирование недоступно. Выделите текст или скачайте файл.');
  }
}

main.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.filter) {
    activeFilter = button.dataset.filter;
    render(`[data-filter="${activeFilter}"]`);
    return;
  }
  if (button.dataset.file) {
    selectedFile = button.dataset.file;
    render(`[data-file="${selectedFile}"]`);
    return;
  }
  if (button.dataset.copyCase) {
    const item = results.find(result => result.id === button.dataset.copyCase);
    await copyText(taskText(item), `Задача ${item.id} скопирована`);
    return;
  }
  const action = button.dataset.action;
  if (action === 'run') {
    results = buildSummary(cases);
    activeFilter = 'all';
    if (location.hash !== '#summary') location.hash = '#summary';
    else render('[data-action="run"]');
    toast(`Сводка обновлена · Требуют внимания: ${results.filter(item => item.needsAttention).length}`);
  } else if (action === 'reset') {
    cases = structuredClone(SAMPLE.cases);
    results = buildSummary(cases);
    activeFilter = 'all';
    render('[data-action="reset"]');
    toast('Исходные данные восстановлены');
  } else if (action === 'copy-summary') {
    await copyText(`${SAMPLE.snapshot.label}\nДемо · Сводка по правилам\n\n${results.map(taskText).join('\n\n')}`, 'Полная сводка скопирована');
  } else if (action === 'copy-code' && loadedCode !== null) {
    await copyText(loadedCode, 'Код скопирован');
  }
});

main.addEventListener('change', (event) => {
  const { id, field } = event.target.dataset;
  if (!id || !field) return;
  const item = cases.find(record => record.id === id);
  if (field === 'documents') {
    item.crm.documents = event.target.value;
    item.crm.status = { pending: 'Документы ожидаются', incomplete: 'Комплект неполный', accepted: 'Документы приняты' }[event.target.value];
  } else if (field === 'received') {
    item.crm.completed = event.target.value === 'yes';
    item.crm.receivedAt = item.crm.completed ? (item.crm.receivedAt ?? '09:50') : null;
    item.crm.status = item.crm.completed ? 'Принято' : 'В пути';
  } else if (field === 'message') {
    item.message = structuredClone(messageScenarios[event.target.value]);
  } else {
    item.crm[field] = event.target.checked;
    item.crm.status = !item.crm.managerApproved ? 'Подтверждение руководителя отсутствует' : item.crm.completed ? 'Процедура завершена' : 'Подтверждение получено';
  }
  render(`[data-id="${id}"][data-field="${field}"]`);
});

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo({ top: 0 });
});
render();
