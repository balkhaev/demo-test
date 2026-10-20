import { SAMPLE } from './data.js';
import { buildSummary } from './engine.js';

let cases = structuredClone(SAMPLE.cases);
let results = buildSummary(cases);
let dirty = false;
let selectedFile = 'engine.js';
let toastTimer;
let renderVersion = 0;
const main = document.querySelector('main');
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const sourceFiles = {
  'engine.js': ['Правила', 'Реальный модуль расчёта. Этот же файл импортируется интерфейсом.'],
  'data.js': ['Данные', 'Исходные четыре случая. Изменения в демо живут только в памяти страницы.'],
  'prompt.txt': ['Промпт для ИИ', 'Инструкция для подключения модели к новым перепискам. В этом демо модель не вызывается.'],
  'app.js': ['Интерфейс', 'Состояние страницы, сценарии и отображение. Обычный JavaScript, без зависимостей.'],
};
const bundledSources = globalThis.__DEMO_SOURCES__;
const downloadUrls = new Map();
function downloadUrl(file) {
  if (!bundledSources) return file === 'project.zip'
    ? 'https://github.com/balkhaev/demo-test/archive/refs/heads/main.zip'
    : file;
  if (!downloadUrls.has(file)) {
    const content = file === 'project.zip'
      ? Uint8Array.from(atob(globalThis.__DEMO_ARCHIVE__), character => character.charCodeAt(0))
      : bundledSources[file];
    downloadUrls.set(file, URL.createObjectURL(new Blob([content], {type:file.endsWith('.zip')?'application/zip':'text/plain;charset=utf-8'})));
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

function crmDescription(item) {
  const fields = [item.deadlineLabel, `Статус: ${item.crm.status}.`];
  if (item.kind === 'delivery' && item.crm.receivedAt) fields.push(`Приёмка подтверждена в ${item.crm.receivedAt}.`);
  if (item.kind === 'onboarding') fields.push(`Документы: ${{pending:'ожидаются',incomplete:'неполный комплект',accepted:'приняты'}[item.crm.documents]}.`);
  if (item.kind === 'offboarding') fields.push(`Подтверждение руководителя: ${item.crm.managerApproved ? 'есть' : 'отсутствует'}. Процедура ${item.crm.completed ? 'завершена' : 'не завершена'}.`);
  return fields.join(' ');
}

function sources(item) {
  return `<details class="sources"><summary>Источники и проверка</summary><div class="source-grid"><div class="source-block"><span class="source-tag">▤ В CRM</span><p>${escapeHtml(crmDescription(item))}</p></div><div class="source-block"><span class="source-tag chat">◌ В переписке · ${escapeHtml(item.message.author)}</span><p>«${escapeHtml(item.message.text)}»</p></div></div><p class="source-check"><strong>Что проверить:</strong> ${escapeHtml(item.check)}</p></details>`;
}

function caseCard(item) {
  return `<article class="case-card ${item.priority}"><div class="case-top"><span class="case-id">${escapeHtml(item.id)}</span><h3 class="case-title">${escapeHtml(item.title)}</h3><span class="status-pill ${item.priority}">${escapeHtml(item.statusLabel)}</span></div><p class="case-reason">${escapeHtml(item.reason)}</p><div class="next-action"><span class="arrow" aria-hidden="true">↳</span><div><strong>Следующий шаг.</strong> ${escapeHtml(item.action)}</div></div>${sources(item)}</article>`;
}

function summaryView() {
  const active = results.filter(item => item.needsAttention);
  const completed = results.filter(item => !item.needsAttention);
  return `<section class="fade-in"><p class="eyebrow">${escapeHtml(SAMPLE.snapshot.label)} · СНИМОК ДАННЫХ</p><div class="heading-row"><div><h1>Утро начинается с ясности.</h1><p class="subtitle">Всё, что требует внимания. С фактами и следующим шагом.</p></div><button class="btn btn-primary" data-action="run"><span class="refresh-icon" aria-hidden="true">↻</span>Обновить сводку</button></div>${dirty ? '<div class="notice warning">Данные изменены. Обновите сводку, чтобы увидеть новый результат.</div>' : ''}<div class="metrics"><div class="metric"><div><span class="metric-label">Случаев в работе</span><span class="metric-number">${results.length}</span><span class="metric-note">из двух источников</span></div><span class="metric-icon" aria-hidden="true">▤</span></div><div class="metric attention"><div><span class="metric-label">Требуют внимания</span><span class="metric-number">${active.length.toString().padStart(2,'0')}</span><span class="metric-note">есть следующий шаг</span></div><span class="metric-icon" aria-hidden="true">↗</span></div><div class="metric"><div><span class="metric-label">Без вмешательства</span><span class="metric-number">${completed.length.toString().padStart(2,'0')}</span><span class="metric-note">всё согласуется</span></div><span class="metric-icon" aria-hidden="true">✓</span></div></div><div class="overview-grid"><div><div class="section-label">В фокусе сегодня <span class="counter">${active.length}</span><span class="section-right">По приоритету ↓</span></div><div class="case-list">${active.map(caseCard).join('') || '<div class="empty">В этих данных нет случаев, требующих вмешательства.</div>'}</div>${completed.length ? `<div class="done-group"><div class="section-label">Без вмешательства <span class="counter">${completed.length}</span></div><div class="case-list">${completed.map(item => `<article class="case-card"><div class="case-top"><span aria-hidden="true" style="color:#7f9864">✓</span><span class="case-id">${escapeHtml(item.id)}</span><h3 class="case-title">${escapeHtml(item.title)}</h3><span class="status-pill done">Всё в порядке</span></div><p class="case-reason">${escapeHtml(item.reason)}</p>${sources(item)}</article>`).join('')}</div></div>` : ''}</div><aside class="aside-panels"><div class="insight-panel"><div class="insight-icon" aria-hidden="true">↗</div><h2>${active.length ? `Начните с ${escapeHtml(active[0].id)}` : 'Можно выдохнуть'}</h2><p>${active[0]?.priority === 'urgent' ? 'Есть сообщение о задержке или расхождении. <strong>Сначала уточните фактическую ситуацию.</strong> Затем переходите к задачам со сроком сегодня.' : active.length ? 'Это ближайшая незавершённая операция. <strong>Проверьте источники и получите недостающее подтверждение.</strong>' : 'По предоставленным данным все вопросы закрыты. Новые сообщения могут изменить ситуацию.'}</p><a class="text-link" href="#data">Посмотреть исходные данные <span>↗</span></a></div><div class="trace-panel"><h2>От данных к действию</h2><div class="trace-step"><span class="step-number">1</span><div><strong>Собрать</strong><p>Запись CRM и связанную<br>переписку по ID случая</p></div></div><div class="trace-step"><span class="step-number">2</span><div><strong>Сопоставить</strong><p>Сроки, подтверждения<br>и расхождения</p></div></div><div class="trace-step"><span class="step-number">3</span><div><strong>Действовать</strong><p>Понятный приоритет<br>и конкретный следующий шаг</p></div></div><div class="trace-foot">Расчёт по правилам · Без вызова ИИ<br>Слова из чата не меняют статус в CRM.</div></div></aside></div><div class="data-toolbar"><button class="btn" data-action="copy-summary">Скопировать сводку <span aria-hidden="true">↗</span></button><span class="field-help">Приоритеты — по срокам задания. Внутренние дедлайны уточняет support.</span></div></section>`;
}

function dataCard(item) {
  const id = escapeHtml(item.id);
  let controls = '';
  if (item.kind === 'onboarding') {
    controls = `<div class="field"><label for="documents-${id}">Документы в CRM</label><select id="documents-${id}" data-field="documents" data-id="${id}">${[['pending','Ожидаются'],['incomplete','Неполный комплект'],['accepted','Приняты']].map(([value,label])=>`<option value="${value}" ${item.crm.documents===value?'selected':''}>${label}</option>`).join('')}</select></div>`;
  } else if (item.kind === 'offboarding') {
    controls = `<div class="field"><label><input type="checkbox" data-id="${id}" data-field="managerApproved" ${item.crm.managerApproved?'checked':''}>Подтверждение руководителя в CRM</label></div><div class="field"><label><input type="checkbox" data-id="${id}" data-field="completed" ${item.crm.completed?'checked':''}>Процедура завершена в CRM</label></div>`;
  } else {
    controls = `<div class="field"><label for="delivery-${id}">Приёмка в CRM</label><select id="delivery-${id}" data-id="${id}" data-field="received"><option value="no" ${!item.crm.completed?'selected':''}>Не подтверждена</option><option value="yes" ${item.crm.completed?'selected':''}>Подтверждена</option></select></div>`;
  }
  return `<article class="data-card"><div class="case-top"><span class="case-id">${id}</span><h2 class="case-title">${escapeHtml(item.title)}</h2></div><span class="source-tag">▤ CRM · ${escapeHtml(item.deadlineLabel)}</span>${controls}<div class="source-block"><span class="source-tag chat">◌ ${escapeHtml(item.message.author)}</span><p>«${escapeHtml(item.message.text)}»</p></div>${item.kind==='delivery'?`<div class="scenario-buttons"><button class="scenario-btn" data-scenario="received" data-id="${id}">Карты получены</button><button class="scenario-btn" data-scenario="missing" data-id="${id}">Обнаружена недостача</button>${item.id==='П-08'?`<button class="scenario-btn" data-scenario="delay" data-id="${id}">Курьер задерживается</button>`:''}</div><p class="field-help">Сценарии меняют только сообщение. Статус CRM задаётся отдельно.</p>`:'<p class="field-help">Сообщение сотрудника остаётся прежним. Меняйте подтверждения и наблюдайте разницу.</p>'}</article>`;
}

function dataView() {
  return `<section class="fade-in"><p class="eyebrow">ПЕСОЧНИЦА · ЧЕТЫРЕ СЛУЧАЯ ИЗ ЗАДАНИЯ</p><div class="heading-row"><div><h1>Поменяйте факт. Увидьте разницу.</h1><p class="subtitle">CRM и переписка независимы. Сводка объяснит, что изменилось.</p></div><button class="btn btn-primary" data-action="run">Собрать сводку <span aria-hidden="true">↗</span></button></div><div class="data-grid">${cases.map(dataCard).join('')}</div><div class="data-toolbar"><button class="btn" data-action="reset">Вернуть исходные данные</button><span class="field-help">Изменения только в этой вкладке. Обновление страницы сбросит демо.</span></div><div class="notice">Тексты сценариев размечены заранее. Демо проверяет правила; свободный текст должен разбирать ИИ по промпту из раздела «Как это устроено».</div></section>`;
}

function codeView() {
  return `<section class="fade-in"><p class="eyebrow">ПРОЗРАЧНАЯ ЛОГИКА · ОТКРЫТЫЙ КОД</p><div class="heading-row"><div><h1>Простое снаружи. Понятное внутри.</h1><p class="subtitle">Одна функция превращает четыре случая в список действий.</p></div><a class="btn" href="project.zip" download>Скачать проект <span aria-hidden="true">↓</span></a></div><div class="subnav" aria-label="Файлы исходного кода">${Object.entries(sourceFiles).map(([file,[name]])=>`<button data-file="${file}" class="${selectedFile===file?'active':''}" aria-pressed="${selectedFile===file}">${name}</button>`).join('')}</div><div class="code-layout"><div><div class="code-box"><div class="code-bar"><span>${selectedFile}</span><div class="code-actions"><button data-action="copy-code">Копировать</button><a href="${selectedFile}" download>Скачать ↓</a></div></div><pre class="code-content" id="code-content" tabindex="0" aria-label="Исходный код">Загрузка файла…</pre></div><p class="field-help">${sourceFiles[selectedFile][1]}</p></div><aside class="code-side"><div class="explanation"><h2>Правила решают.<br>ИИ извлекает факты.</h2><p>В рабочей версии модель выделяет из сообщений сведения и источники. Проверяемые правила определяют приоритет, а человек подтверждает действие.</p><ul><li>Отправлено ≠ принято.</li><li>«В курсе» ≠ согласовано.</li><li>«Не раньше» ≠ точное время.</li></ul></div><div class="explanation"><div class="mini-title">Что работает сейчас</div><p>Детерминированная сводка, сценарии, проверка расхождений и 11 автоматических тестов логики.</p><div class="mini-title">Следующий шаг</div><p>Подключить разрешённые данные CRM и чатов, проверить извлечение моделью и сравнить с ручной сводкой.</p></div></aside></div><section class="launch"><h2>Первый запуск</h2><p>Каждый рабочий день в 10:00 решение получает разрешённую выгрузку CRM и связанные сообщения, сопоставляя их по ID случая. Сотрудник видит сводку в рабочем канале support со ссылками на первоисточники, а несопоставленные записи — в отдельном списке проверки. Перед действием он проверяет актуальность статуса, автора сообщения и обязательные подтверждения. Первую неделю сводка работает параллельно с ручной проверкой, а команда разбирает пропуски и лишние задачи. Сравниваем время подготовки и полноту выявления срочных случаев; подключаем регулярную работу после подтверждения экономии времени без критичных пропусков на проверенной выборке.</p></section></section>`;
}

async function loadCode(version) {
  try {
    if (bundledSources) {
      document.querySelector('#code-content').textContent = bundledSources[selectedFile];
      return;
    }
    const response = await fetch(selectedFile);
    if (!response.ok) throw new Error('File unavailable');
    const code = await response.text();
    if (version === renderVersion) document.querySelector('#code-content').textContent = code;
  } catch {
    if (version === renderVersion) document.querySelector('#code-content').textContent = 'Не удалось загрузить файл. Откройте его по ссылке «Скачать».';
  }
}

function render() {
  const route = ['summary','data','code'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'summary';
  renderVersion += 1;
  for (const link of document.querySelectorAll('[data-nav]')) {
    link.classList.toggle('active', link.dataset.nav === route);
    if (link.dataset.nav === route) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
  }
  document.querySelector('#crumb').textContent = {summary:'Обзор',data:'Исходные данные',code:'Как это устроено'}[route];
  document.querySelector('#nav-count').textContent = results.filter(item=>item.needsAttention).length;
  main.innerHTML = {summary:summaryView,data:dataView,code:codeView}[route]();
  for (const link of main.querySelectorAll('a[download]')) {
    const file = link.getAttribute('href');
    link.setAttribute('download', file);
    link.setAttribute('href', downloadUrl(file));
  }
  if (route === 'code') void loadCode(renderVersion);
}

async function copyText(text, success) {
  try { await navigator.clipboard.writeText(text); toast(success); }
  catch { toast('Копирование недоступно. Выделите текст или скачайте файл.'); }
}

main.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.file) { selectedFile = button.dataset.file; render(); return; }
  if (button.dataset.scenario) {
    const item = cases.find(item=>item.id===button.dataset.id);
    const scenario = button.dataset.scenario;
    item.message = {
      received:{author:'Получатель',text:'Карты получили, количество проверили',signal:'received',notBefore:null},
      missing:{author:'Получатель',text:'При повторной проверке обнаружили недостачу карт',signal:'missing',notBefore:null},
      delay:{author:'Курьер',text:'Задерживаюсь, раньше 13:00 не приеду',signal:'delay',notBefore:'13:00'},
    }[scenario];
    dirty = true; render(); toast('Сообщение изменено. Соберите сводку.'); return;
  }
  const action = button.dataset.action;
  if (action === 'run') {
    results = buildSummary(cases); dirty = false;
    if (location.hash !== '#summary') location.hash = '#summary'; else render();
    toast(`Сводка обновлена · ${results.filter(item=>item.needsAttention).length} требуют внимания`);
  }
  if (action === 'reset') {
    cases = structuredClone(SAMPLE.cases); results = buildSummary(cases); dirty = false; render(); toast('Исходные данные восстановлены');
  }
  if (action === 'copy-summary') {
    await copyText(`${SAMPLE.snapshot.label}\nДемо · расчёт по правилам\n\n${results.map(item=>`${item.id} — ${item.title} · ${item.statusLabel}\nВ CRM: ${crmDescription(item)}\nВ переписке (${item.message.author}): «${item.message.text}»\nВывод: ${item.reason}\nПроверить: ${item.check}\nДействие: ${item.action}`).join('\n\n')}`, 'Сводка скопирована');
  }
  if (action === 'copy-code') await copyText(document.querySelector('#code-content').textContent,'Код скопирован');
});

main.addEventListener('change', (event) => {
  const { id, field } = event.target.dataset;
  if (!id || !field) return;
  const item = cases.find(item=>item.id===id);
  if (field === 'documents') {
    item.crm.documents = event.target.value;
    item.crm.status = {pending:'Документы ожидаются',incomplete:'Неполный комплект',accepted:'Документы приняты'}[event.target.value];
  } else if (field === 'received') {
    item.crm.completed = event.target.value === 'yes';
    item.crm.receivedAt = item.crm.completed ? '09:50' : null;
    item.crm.status = item.crm.completed ? 'Принято' : 'В пути';
  } else {
    item.crm[field] = event.target.checked;
    item.crm.status = !item.crm.managerApproved ? 'Подтверждение руководителя отсутствует' : item.crm.completed ? 'Процедура завершена' : 'Подтверждение получено';
  }
  dirty = true;
  toast('Данные изменены. Соберите сводку.');
});

window.addEventListener('hashchange', () => { render(); window.scrollTo({top:0}); });
render();
