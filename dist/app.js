import { logicRoute, logicView } from './logic-view.js?v=7';
import { logicText } from './logic-guide.js?v=7';
import { highlight } from './highlight.js?v=7';

const main = document.querySelector('main');
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const caseUrl = id => `#/cases/${encodeURIComponent(id)}`;
const ruleUrl = id => `#/logic?file=rules&rule=${encodeURIComponent(id)}`;
const priorities = {urgent:'Сейчас',today:'Сегодня','before-start':'До срока',done:'В порядке'};
const checkLabels = {met:'Подтверждено',missing:'Не выполнено',unknown:'Нет данных'};
const sourceCache = new Map();
const drafts = new Map();
const comparisons = new Map();
let model = null;
let guide = null;
let guideError = null;
let guideLoading = false;
let initialCases = [];
let activeFilter = 'all';
let busy = false;
let error = null;
let renderVersion = 0;
let loadedSource = null;
let toastTimer;

function route() {
  const hash = location.hash.slice(1);
  if (!hash || hash === 'summary' || hash === '/summary' || hash === 'main' || hash === 'data') return {name:'summary'};
  if (hash === 'code') return logicRoute(new URLSearchParams(), guide?.topics);
  const [path, query] = hash.split('?');
  if (path === '/logic') {
    const params = new URLSearchParams(query);
    return logicRoute(params, guide?.topics);
  }
  if (path.startsWith('/cases/')) {
    try { return {name:'case',id:decodeURIComponent(path.slice(7))}; }
    catch { return {name:'missing'}; }
  }
  return {name:'missing'};
}

function formatDate(value, short = false) {
  if (!value) return 'Время не указано';
  return new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'short',...(short ? {} : {hour:'2-digit',minute:'2-digit'})}).format(new Date(value)) + (short ? '' : ' МСК');
}

function inputDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)).replace(' ','T');
}

function deadlineText(item) {
  if (item.dueAt) return 'Срок — ' + formatDate(item.dueAt);
  if (item.dueDate) return (item.kind === 'onboarding' ? 'Первый выход — ' : 'Дата операции — ') + formatDate(item.dueDate + 'T00:00:00+03:00',true);
  return 'Плановый срок не указан';
}

function priority(item) {
  const label = item.priority === 'before-start' && item.kind === 'onboarding' ? 'До выхода' : priorities[item.priority];
  return `<span class="priority ${h(item.priority)}">${label}</span>`;
}

function crmFacts(item) {
  if (item.kind === 'onboarding') return {
    title: {pending:'Документы ожидаются',incomplete:'Комплект неполный',accepted:'Документы приняты'}[item.crm.documents] ?? 'Статус документов неизвестен',
    detail: item.crm.documents === 'accepted' ? 'Приём зафиксирован в CRM' : 'Полный комплект не подтверждён',
  };
  if (item.kind === 'offboarding') return {
    title: item.crm.managerApproved === true ? 'Согласование есть' : item.crm.managerApproved === false ? 'Нет согласования руководителя' : 'Согласование не проверено',
    detail: item.crm.completed === true ? 'Процедура отмечена завершённой' : item.crm.completed === false ? 'Процедура не завершена' : 'Завершение не проверено',
  };
  return {
    title: item.crm.completed === true ? 'Принято' : item.crm.completed === false ? item.crm.status : 'Статус не проверен',
    detail: item.crm.receivedAt ? `Приёмка: ${formatDate(item.crm.receivedAt)}` : 'Время приёмки не указано',
  };
}

function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('visible'),2800);
}

async function api(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(),15000);
  try {
    const response = await fetch(path,{method:body ? 'POST' : 'GET',headers:body ? {'Content-Type':'application/json'} : {},body:body ? JSON.stringify(body) : undefined,signal:controller.signal});
    const payload = await response.json();
    if (!response.ok) {
      const failure = new Error(payload.error?.message ?? 'Не удалось выполнить запрос.');
      failure.fields = payload.error?.fields ?? [];
      throw failure;
    }
    return payload;
  } catch (cause) {
    if (cause.name === 'AbortError') throw new Error('Сервер не ответил за 15 секунд. Повторите запрос.');
    throw cause;
  } finally { clearTimeout(timer); }
}

async function loadDemo() {
  busy = true;
  error = null;
  render();
  try {
    model = await api('/api/demo');
    if(guide && guide.rulesVersion!==model.rulesVersion) void loadGuide();
    initialCases = structuredClone(model.cases);
    drafts.clear();
    comparisons.clear();
  } catch (cause) { error = cause; }
  finally { busy = false; render(); }
}

async function evaluate(caseId) {
  if (busy) return;
  const before = caseId ? structuredClone(model.summary.find(item => item.id === caseId)) : null;
  const candidate = model.cases.map(item => item.id === caseId && drafts.has(caseId) ? structuredClone(drafts.get(caseId)) : item);
  busy = true;
  error = null;
  render();
  try {
    const result = await api('/api/evaluate',{asOf:model.asOf,cases:candidate});
    model = {...model,...result};
    if(guide && guide.rulesVersion!==model.rulesVersion) void loadGuide();
    if (caseId) {
      drafts.delete(caseId);
      comparisons.set(caseId,{before,after:model.summary.find(item => item.id === caseId)});
    }
    toast(caseId ? 'Сценарий рассчитан на сервере. Сводка обновлена.' : 'Сводка пересчитана на сервере.');
  } catch (cause) { error = cause; }
  finally { busy = false; render(); }
}

function errorNotice() {
  if (!error) return '';
  return `<div class="notice error-notice" role="alert"><div><strong>Расчёт не выполнен.</strong> ${h(error.message)}${error.fields?.length ? `<ul>${error.fields.map(field=>`<li><code>${h(field.path)}</code>: ${h(field.message)}</li>`).join('')}</ul>` : ''}<p>Последний успешный результат сохранён. Исправьте данные и повторите запрос.</p></div></div>`;
}

function taskText(item) {
  const facts = crmFacts(item);
  return `${item.id} · ${item.title}\n${item.statusLabel}\nСнимок: ${formatDate(model.asOf)}\nCRM: ${facts.title}. ${facts.detail}.\nПереписка (${item.message.author}): «${item.message.text}»\nОснование: ${item.reason}\nПроверить: ${item.check}\nСледующий шаг: ${item.action}\nУсловия снятия задачи:\n${item.closureConditions.map(value=>'- '+value).join('\n')}\nПравило: ${item.ruleId}`;
}

function summaryView() {
  const counts = model.counts;
  const shown = model.summary.filter(item=>activeFilter==='all' || (activeFilter==='attention' ? item.needsAttention : !item.needsAttention));
  const filters = [['all','Все',counts.total],['attention','Требуют внимания',counts.attention],['done','Без действий',counts.done]];
  return `<section aria-labelledby="page-title">
    <div class="heading-row"><div><div class="eyebrow">Рабочая очередь</div><h1 id="page-title">Сводка поддержки</h1><p class="subtitle">Снимок: ${formatDate(model.asOf)} <span class="text-separator">·</span> <span class="server-label">Расчёт на сервере</span></p></div><div class="heading-actions"><button class="btn" data-action="copy-summary">Копировать</button><button class="btn" data-action="reset" ${busy?'disabled':''}>Сбросить демо</button><button class="btn btn-primary" data-action="refresh" ${busy?'disabled':''}>${busy?'Пересчитываем…':'↻ Пересчитать'}</button></div></div>
    ${errorNotice()}
    <div class="intro-note"><span class="note-mark">i</span><p>Откройте случай, чтобы проверить источники, понять решение и испытать другой сценарий.</p><a href="${caseUrl('П-08')}">Разобрать П-08 →</a></div>
    <div class="board"><div class="board-toolbar"><div class="filters" role="group" aria-label="Фильтр случаев">${filters.map(([key,label,count])=>`<button class="filter ${key===activeFilter?'active':''}" data-filter="${key}" aria-pressed="${key===activeFilter}">${label}<span>${count}</span></button>`).join('')}</div><span class="sort-label">Сначала срочное ↓</span></div>
    <table class="case-table" aria-label="Случаи поддержки"><thead><tr><th scope="col">Случай и срок</th><th scope="col">В CRM</th><th scope="col">В переписке</th><th scope="col">Следующий шаг</th></tr></thead><tbody>${shown.map(item=>{
      const facts=crmFacts(item);
      return `<tr class="case-row ${h(item.priority)}"><td class="case-cell"><div class="case-top"><a class="case-id" href="${caseUrl(item.id)}">${h(item.id)}</a>${priority(item)}</div><h2 class="case-title"><a href="${caseUrl(item.id)}">${h(item.title)}</a></h2><p class="deadline">${h(deadlineText(item))}</p></td><td class="source-cell" data-label="CRM"><strong class="source-status">${h(facts.title)}</strong><p class="source-detail">${h(facts.detail)}</p></td><td class="source-cell" data-label="Переписка"><span class="message-author">${h(item.message.author)}</span><p class="message-text">«${h(item.message.text)}»</p></td><td class="action-cell"><p class="action-text">${h(item.action)}</p><a class="case-open" href="${caseUrl(item.id)}" aria-label="Разобрать случай ${h(item.id)}">Разобрать случай <span aria-hidden="true">→</span></a></td></tr>`;
    }).join('') || '<tr><td class="empty" colspan="4">В этой группе нет случаев.</td></tr>'}</tbody></table>
    <div class="board-footer"><span><strong>Требуют внимания: ${counts.attention}</strong> · Срочных: ${counts.urgent} · Без действий: ${counts.done}</span><a href="#/logic">Как принято решение →</a></div></div>
    <p class="quick-tip">Это фиксированный учебный снимок. Сроки считаются относительно него, а изменения действуют только в вашей вкладке.</p>
  </section>`;
}

function sourceCard(item,type) {
  const isCrm=type==='crm';
  const source=item.sources[type];
  const facts=crmFacts(item);
  return `<section class="evidence-card" aria-labelledby="source-${type}"><div class="panel-heading"><h2 id="source-${type}">${isCrm?'Запись CRM':'Сообщение из чата'}</h2><span class="source-id">${h(source.id)}</span></div>
    ${isCrm ? `<p class="evidence-main">${h(facts.title)}</p><p class="source-detail">${h(facts.detail)}</p><dl class="facts-list"><div><dt>Срок</dt><dd>${h(deadlineText(item))}</dd></div><div><dt>Обновлено</dt><dd>${formatDate(source.updatedAt)}</dd></div></dl>` : `<blockquote>«${h(item.message.text)}»</blockquote><dl class="facts-list"><div><dt>Автор</dt><dd>${h(item.message.author)}</dd></div><div><dt>Время сообщения</dt><dd>${formatDate(item.message.occurredAt)}</dd></div></dl>`}
    <p class="source-footnote">Демо-источник. Время и подтверждения не восстанавливаются догадками.</p></section>`;
}

function checkList(item) {
  return `<section class="panel"><div class="panel-heading"><h2>Что проверили правила</h2><span class="subtle">Проверок: ${item.checks.length}</span></div><ul class="check-list">${item.checks.map(check=>`<li><span class="check-state ${h(check.status)}" aria-hidden="true">${check.status==='met'?'✓':check.status==='missing'?'!':'?'}</span><div><strong>${h(check.label)}</strong><span class="check-origin">${h(check.sourceIds.join(' · '))}</span></div><span class="check-label ${h(check.status)}">${checkLabels[check.status]}</span></li>`).join('')}</ul>
    <details class="rule-trace"><summary>Путь принятия решения · шагов: ${item.trace.length}</summary><ol>${item.trace.map(step=>`<li class="${step.matched?'matched':''}"><span class="trace-result">${step.matched?'Сработало':'Не сработало'}</span><strong>${h(step.title)}</strong><code>${h(step.ruleId)}</code></li>`).join('')}</ol><p class="field-help">Правила проверяются по порядку до первого совпадения.</p></details></section>`;
}

function selectField(id,label,field,value,options) {
  return `<div class="field"><label for="${id}">${label}</label><select id="${id}" data-field="${field}" ${busy?'disabled':''}>${options.map(([key,text])=>`<option value="${key}" ${String(value??'unknown')===key?'selected':''}>${text}</option>`).join('')}</select></div>`;
}

function dateField(id,label,field,value) {
  return `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="datetime-local" data-field="${field}" value="${h(inputDate(value))}" ${busy?'disabled':''}><span class="input-help">МСК. Пустое поле — время неизвестно.</span></div>`;
}

function scenarioPanel(item) {
  const draft=drafts.get(item.id)??model.cases.find(record=>record.id===item.id);
  const edited=JSON.stringify(draft)!==JSON.stringify(model.cases.find(record=>record.id===item.id));
  const booleanOptions=[['false','Нет'],['true','Да'],['unknown','Нет данных']];
  let crmControls='';
  if(item.kind==='onboarding') crmControls=selectField('documents','Документы','documents',draft.crm.documents,[['pending','Ожидаются'],['incomplete','Неполный комплект'],['accepted','Приняты'],['unknown','Нет данных']]);
  if(item.kind==='offboarding') crmControls=selectField('approval','Подтверждение руководителя','managerApproved',draft.crm.managerApproved,booleanOptions)+selectField('completed','Процедура завершена','completed',draft.crm.completed,booleanOptions);
  if(item.kind==='delivery') crmControls=selectField('completed','Поставка отмечена завершённой','completed',draft.crm.completed,booleanOptions)+dateField('received-at','Время подтверждённой приёмки','receivedAt',draft.crm.receivedAt);
  const messageOptions=item.kind==='delivery'?[['delay','Курьер задерживается'],['received','Карты получены'],['missing','Обнаружена недостача'],['none','Нет подтверждающих сведений']]:item.kind==='onboarding'?[['sent','Документы отправлены'],['missing','Документов не хватает'],['none','Нет подтверждающих сведений']]:[['aware','Руководитель в курсе'],['none','Нет подтверждающих сведений']];
  const change=comparisons.get(item.id);
  return `<section class="panel scenario-panel" id="scenario"><div class="panel-heading"><div><h2>Проверить другой сценарий</h2><p class="field-help">Измените факты и отправьте их на сервер. CRM и сообщение независимы.</p></div>${edited?'<span class="edited-label">Есть изменения</span>':''}</div>
    <div class="scenario-grid"><fieldset><legend>Факты CRM</legend>${crmControls}</fieldset><fieldset><legend>Сведения из переписки</legend>${selectField('signal','Сценарий сообщения','signal',draft.message.signal,messageOptions)}${dateField('message-at','Время сообщения','occurredAt',draft.message.occurredAt)}<p class="draft-quote">«${h(draft.message.text)}»</p></fieldset></div>
    <div class="scenario-actions"><button class="btn btn-primary" data-action="evaluate-case" ${busy?'disabled':''}>${busy?'Считаем на сервере…':'Проверить решение'}</button><button class="btn" data-action="restore-case" ${busy?'disabled':''}>Исходный случай</button><span>Статусы внешней CRM не меняются.</span></div>
    ${change?`<div class="comparison" role="status"><div><span class="mini-title">До проверки</span>${priority(change.before)}<p>${h(change.before.reason)}</p></div><div class="comparison-after"><span class="mini-title">Результат сервера</span>${priority(change.after)}<p>${h(change.after.reason)}</p></div></div>`:''}
    <p class="field-help">Сценарии сообщений размечены вручную. Свободный текст не анализируется моделью.</p>
  </section>`;
}

function detailView(id) {
  const item=model.summary.find(record=>record.id===id);
  if(!item) return missingView();
  const index=model.summary.findIndex(record=>record.id===id);
  const next=model.summary[(index+1)%model.summary.length];
  return `<section aria-labelledby="page-title">
    <div class="breadcrumb"><a href="#/summary">← Все случаи</a><span>/</span><span>${h(id)}</span></div>
    <div class="heading-row"><div><div class="eyebrow">Разбор случая · ${h(id)}</div><h1 id="page-title">${h(item.title)}</h1><p class="subtitle">${h(deadlineText(item))} <span class="text-separator">·</span> Снимок ${formatDate(model.asOf)}</p></div><div class="heading-actions"><button class="btn" data-action="copy-case" data-id="${h(id)}">Копировать задачу</button><a class="btn" href="${caseUrl(next.id)}">Следующий: ${h(next.id)} →</a></div></div>
    ${errorNotice()}
    <section class="decision-banner ${h(item.priority)}" aria-label="Решение"><div class="decision-icon" aria-hidden="true">${item.needsAttention?'!':'✓'}</div><div><div class="decision-title">${priority(item)}<h2>${h(item.statusLabel)}</h2></div><p>${h(item.reason)}</p><a href="${ruleUrl(item.ruleId)}" class="rule-link">Правило <code>${h(item.ruleId)}</code> ↗</a></div></section>
    <div class="detail-grid"><div class="detail-main"><div class="evidence-grid">${sourceCard(item,'crm')}${sourceCard(item,'message')}</div>${checkList(item)}</div>
    <aside class="detail-side"><section class="panel action-panel"><p class="mini-title">Следующий шаг</p><h2>${item.needsAttention?'Что сделать':'Действие не требуется'}</h2><p class="recommended-action">${h(item.action)}</p><div class="verify-note"><strong>Перед действием</strong><p>${h(item.check)}</p></div><h3>Условия снятия задачи</h3><ul class="closure-list">${item.closureConditions.map(condition=>`<li>${h(condition)}</li>`).join('')}</ul></section>
    ${item.uncertainties.length?`<section class="uncertainty-panel"><h2>Что пока неизвестно</h2><ul>${item.uncertainties.map(value=>`<li>${h(value.text)}</li>`).join('')}</ul></section>`:''}</aside></div>
    ${scenarioPanel(item)}
    <details class="api-details"><summary>Ответ API для этого случая <span>JSON · версия правил ${h(model.rulesVersion)}</span></summary><pre>${h(JSON.stringify(item,null,2))}</pre></details>
  </section>`;
}

function missingView() {
  return '<section class="empty-state"><h1>Случай не найден</h1><p>Откройте один из случаев в текущей сводке.</p><a class="btn btn-primary" href="#/summary">Вернуться к сводке</a></section>';
}

async function loadGuide() {
  if (guideLoading) return;
  guideLoading=true;
  guideError=null;
  render();
  try {
    const result=await api('/api/logic');
    if(model && result.rulesVersion!==model.rulesVersion) {
      throw new Error('Версия правил изменилась во время запроса. Пересчитайте сводку и повторите загрузку.');
    }
    guide=result;
    sourceCache.clear();
  }
  catch(cause) { guideError=cause; }
  finally { guideLoading=false; render(); }
}

async function loadSource(current,version) {
  try {
    let source=sourceCache.get(current.file);
    if(!source) { source=await api('/api/source/'+current.file); sourceCache.set(current.file,source); }
    if(version!==renderVersion) return;
    if(source.revision!==guide.revision) throw new Error('Сайт обновлён. Перезагрузите страницу, чтобы открыть правила и исходник одной версии.');
    loadedSource=source;
    document.querySelector('#source-path').textContent=source.path;
    const pre=document.querySelector('#code-content');
    const selected=guide.topics[current.topic].rules?.find(rule=>rule.id===current.rule)?.source;
    pre.innerHTML=highlight(source.content,source.language).split('\n').map((line,index)=>`<span class="code-line ${selected&&index+1>=selected.line&&index+1<=selected.endLine?'highlight-line':''}"><a class="line-number" aria-label="Строка ${index+1} в GitHub" href="${h(source.githubUrl)}#L${index+1}" target="_blank" rel="noopener">${index+1}</a><span>${line||' '}</span></span>`).join('');
    pre.setAttribute('aria-busy','false');
    for(const button of main.querySelectorAll('[data-action="copy-code"],[data-action="download-code"]')) button.disabled=false;
    if(current.rule) main.querySelector('.highlight-line')?.scrollIntoView({block:'center'});
  } catch(cause) {
    if(version!==renderVersion) return;
    document.querySelector('#code-content').textContent='Не удалось получить исходник. '+cause.message+' Файл также доступен в GitHub.';
    document.querySelector('#code-content').setAttribute('aria-busy','false');
  }
}

function render(focusTarget) {
  const current=route();
  renderVersion+=1;
  loadedSource=null;
  document.title=current.name==='case' ? `${current.id} — Сводка поддержки` : current.name==='logic' ? 'Бизнес-логика — Сводка поддержки' : 'Сводка поддержки — Руссмаркет';
  for(const link of document.querySelectorAll('[data-nav]')) {
    const active=link.dataset.nav===(current.name==='logic'?'logic':'summary');
    link.classList.toggle('active',active);
    if(active) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
  }
  document.querySelector('#nav-count').textContent=model?.counts.attention??'—';
  if(current.name==='logic' && (!guide || (model && guide.rulesVersion!==model.rulesVersion))) {
    main.innerHTML=guideError?`<section class="empty-state" role="alert"><h1>Не удалось загрузить правила</h1><p>${h(guideError.message)}</p><button class="btn btn-primary" data-action="retry-logic">Повторить запрос</button></section>`:'<div class="loading-state" role="status">Получаем исполняемые правила…</div>';
    return;
  }
  if(!model && current.name !== 'logic') {
    main.innerHTML=error?`<section class="empty-state" role="alert"><h1>Сервер пока недоступен</h1><p>${h(error.message)}</p><button class="btn btn-primary" data-action="retry">Повторить запрос</button></section>`:'<div class="loading-state" role="status">Получаем сводку с сервера…</div>';
    return;
  }
  main.innerHTML=current.name==='summary'?summaryView():current.name==='case'?detailView(current.id):current.name==='logic'?logicView(current,guide.topics):missingView();
  if(current.name==='logic' && current.source) void loadSource(current,renderVersion);
  if(current.name==='logic' && current.rule && !current.source) {
    main.querySelector('#selected-rule')?.scrollIntoView({block:'center'});
  }
  if(focusTarget) main.querySelector(focusTarget)?.focus({preventScroll:true});
}

async function copyText(text,message) {
  try { await navigator.clipboard.writeText(text); toast(message); }
  catch { toast('Копирование недоступно. Выделите текст или скачайте файл.'); }
}

main.addEventListener('click',async event=>{
  const button=event.target.closest('button');
  if(!button) return;
  if(button.dataset.filter) {activeFilter=button.dataset.filter;render(`[data-filter="${activeFilter}"]`);return;}
  const action=button.dataset.action;
  const current=route();
  if(action==='reset'||action==='retry') {if(!busy) await loadDemo();}
  else if(action==='retry-logic') await loadGuide();
  else if(action==='refresh') await evaluate();
  else if(action==='evaluate-case') await evaluate(current.id);
  else if(action==='restore-case'&&!busy) {
    drafts.set(current.id,structuredClone(initialCases.find(item=>item.id===current.id)));
    await evaluate(current.id);
  } else if(action==='copy-case') await copyText(taskText(model.summary.find(item=>item.id===button.dataset.id)),'Задача скопирована');
  else if(action==='copy-summary') await copyText(model.summary.map(taskText).join('\n\n'),'Полная сводка скопирована');
  else if(action==='copy-logic') await copyText(logicText(guide.topics,current.topic),'Псевдокод скопирован');
  else if(action==='copy-code'&&loadedSource) await copyText(loadedSource.content,'Бизнес-код скопирован');
  else if(action==='download-code'&&loadedSource) {
    const url=URL.createObjectURL(new Blob([loadedSource.content],{type:'text/plain;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=url;link.download=loadedSource.path.split('/').at(-1);link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  } else if(action==='find-rule') {
    const line=main.querySelector('#selected-rule,.highlight-line');
    if(line) { line.scrollIntoView({block:'center',behavior:'smooth'}); line.focus({preventScroll:true}); }
    else toast('Указанное правило не найдено в этом файле.');
  }
});

main.addEventListener('change',event=>{
  const field=event.target.dataset.field;
  const current=route();
  if(!field||current.name!=='case'||busy) return;
  const item=structuredClone(drafts.get(current.id)??model.cases.find(record=>record.id===current.id));
  const value=event.target.value;
  if(field==='documents') {
    item.crm.documents=value==='unknown'?null:value;
    item.crm.status={pending:'Документы ожидаются',incomplete:'Комплект неполный',accepted:'Документы приняты',unknown:'Статус неизвестен'}[value];
  } else if(field==='completed'||field==='managerApproved') {
    item.crm[field]=value==='unknown'?null:value==='true';
    if(item.kind==='delivery') item.crm.status=item.crm.completed===true?'Принято':item.crm.completed===false?'В пути':'Статус неизвестен';
    if(item.kind==='offboarding') item.crm.status=item.crm.managerApproved===true?'Подтверждение получено':'Подтверждение не зафиксировано';
  } else if(field==='receivedAt'||field==='occurredAt') {
    const timestamp=value ? value+':00+03:00' : null;
    if(field==='receivedAt') item.crm.receivedAt=timestamp; else item.message.occurredAt=timestamp;
  } else if(field==='signal') {
    const messages={
      delay:{author:'Курьер',text:'Задерживаюсь, раньше 13:00 не приеду',notBefore:'13:00'},
      received:{author:'Получатель',text:'Карты получили, количество проверили',notBefore:null},
      missing:{author:item.kind==='delivery'?'Получатель':'Руководитель',text:item.kind==='delivery'?'При повторной проверке обнаружили недостачу карт':'В полученном комплекте не хватает документов',notBefore:null},
      sent:{author:'Сотрудник',text:'Вчера отправил фотографии документов руководителю в личку',notBefore:null},
      aware:{author:'Сотрудник',text:'С руководителем всё обсудили, он в курсе',notBefore:null},
      none:{author:'Источник не уточнён',text:'Подтверждающих сведений в переписке нет',notBefore:null},
    };
    item.message={...item.message,...messages[value],signal:value};
  }
  drafts.set(current.id,item);
  error=null;
  render(`[data-field="${field}"]`);
});

window.addEventListener('hashchange',()=>{window.scrollTo({top:0});render();});
void loadDemo();
void loadGuide();
