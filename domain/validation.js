const CASE_KINDS = new Set(['delivery', 'onboarding', 'offboarding']);
const DOCUMENT_STATES = new Set(['pending', 'incomplete', 'accepted']);
const MESSAGE_SIGNALS = new Set(['delay', 'received', 'missing', 'sent', 'aware', 'none']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export class DomainInputError extends TypeError {
  constructor(code, path, message) {
    super(message);
    this.name = 'DomainInputError';
    this.code = code;
    this.path = path;
  }
}

function fail(path, message, code = 'INVALID_FIELD') {
  throw new DomainInputError(code, path, message);
}

function record(value, path, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'Ожидается объект с полями.');
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(path ? path + '.' + key : key, 'Неизвестное поле.');
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) fail(path ? path + '.' + key : key, 'Обязательное поле отсутствует. Неизвестное значение передайте как null.');
  }
}

function text(value, path, maximum) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    fail(path, 'Ожидается непустая строка длиной до ' + maximum + ' символов.');
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail(path, 'Строка содержит недопустимые управляющие символы.');
}

function nullableBoolean(value, path) {
  if (value !== null && typeof value !== 'boolean') fail(path, 'Ожидается true, false или null.');
}

function date(value, path, nullable = true) {
  if (value === null && nullable) return;
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) fail(path, 'Укажите дату в формате YYYY-MM-DD или null.');
  const parsed = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(path, 'Указанной календарной даты не существует.');
}

function instant(value, path, nullable = true) {
  if (value === null && nullable) return;
  if (typeof value !== 'string' || !INSTANT_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    fail(path, 'Укажите дату и время ISO 8601 с часовым поясом, например 2026-10-19T10:00:00+03:00.');
  }
  date(value.slice(0, 10), path, false);
}

function enumeration(value, path, values, nullable = false) {
  if (nullable && value === null) return;
  if (!values.has(value)) fail(path, 'Недопустимое значение. Допустимы: ' + [...values].join(', ') + (nullable ? ', null.' : '.'));
}

function validateCase(item, index) {
  const path = 'cases[' + index + ']';
  record(item, path, ['id', 'kind', 'title', 'deadlineLabel', 'dueDate', 'dueAt', 'crm', 'message', 'sources']);
  text(item.id, path + '.id', 64);
  text(item.title, path + '.title', 160);
  text(item.deadlineLabel, path + '.deadlineLabel', 200);
  enumeration(item.kind, path + '.kind', CASE_KINDS);
  date(item.dueDate, path + '.dueDate');
  instant(item.dueAt, path + '.dueAt');
  if (item.dueDate !== null && item.dueAt !== null) {
    fail(path + '.dueAt', 'Укажите либо календарную дату dueDate, либо точный срок dueAt. Одновременно заполнить их нельзя.', 'CONFLICTING_DEADLINES');
  }

  const crmPath = path + '.crm';
  record(item.crm, crmPath, ['status', 'documents', 'managerApproved', 'completed', 'receivedAt']);
  text(item.crm.status, crmPath + '.status', 200);
  enumeration(item.crm.documents, crmPath + '.documents', DOCUMENT_STATES, true);
  nullableBoolean(item.crm.managerApproved, crmPath + '.managerApproved');
  nullableBoolean(item.crm.completed, crmPath + '.completed');
  instant(item.crm.receivedAt, crmPath + '.receivedAt');

  const messagePath = path + '.message';
  record(item.message, messagePath, ['author', 'text', 'signal', 'notBefore', 'occurredAt']);
  text(item.message.author, messagePath + '.author', 100);
  text(item.message.text, messagePath + '.text', 4000);
  enumeration(item.message.signal, messagePath + '.signal', MESSAGE_SIGNALS);
  if (item.message.notBefore !== null && (typeof item.message.notBefore !== 'string' || !TIME_PATTERN.test(item.message.notBefore))) {
    fail(messagePath + '.notBefore', 'Укажите время в формате HH:mm или null.');
  }
  instant(item.message.occurredAt, messagePath + '.occurredAt');

  record(item.sources, path + '.sources', ['crm', 'message']);
  record(item.sources.crm, path + '.sources.crm', ['id', 'updatedAt']);
  text(item.sources.crm.id, path + '.sources.crm.id', 160);
  instant(item.sources.crm.updatedAt, path + '.sources.crm.updatedAt');
  record(item.sources.message, path + '.sources.message', ['id']);
  text(item.sources.message.id, path + '.sources.message.id', 160);
}

/**
 * Validate the transport-independent snapshot contract.
 * Unknown business facts are explicit nulls, never invented confirmations.
 * Returns the input unchanged; rules/service own immutable result snapshots.
 */
export function validateSnapshot(input) {
  record(input, '', ['asOf', 'cases']);
  instant(input.asOf, 'asOf', false);
  if (!Array.isArray(input.cases) || input.cases.length > 50) {
    fail('cases', 'Ожидается массив не более чем из 50 случаев.', 'INVALID_CASES');
  }
  const ids = new Set();
  for (const [index, item] of input.cases.entries()) {
    validateCase(item, index);
    if (ids.has(item.id)) fail('cases[' + index + '].id', 'ID случая должен быть уникальным.', 'DUPLICATE_CASE_ID');
    ids.add(item.id);
  }
  return input;
}
