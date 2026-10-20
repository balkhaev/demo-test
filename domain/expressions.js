import { calendarDate } from './dates.js';

// Small expression language: the interpreter and the guide consume the same tree.
export const field = path => ({ op: 'field', path });
export const eq = (left, right) => ({ op: 'eq', left, right });
export const not = value => ({ op: 'not', value });
export const all = (...values) => ({ op: 'all', values });
export const any = (...values) => ({ op: 'any', values });
export const before = (left, right) => ({ op: 'before', left, right });
export const after = (left, right) => before(right, left);
export const instant = value => ({ op: 'instant', value });
export const day = value => ({ op: 'day', value });
export const otherwise = (left, right) => ({ op: 'otherwise', left, right });

export function evaluate(expression, context) {
  if (expression === null || typeof expression !== 'object') return expression;
  const read = value => evaluate(value, context);
  switch (expression.op) {
    case 'field': {
      const value = expression.path.split('.').reduce((object, key) => object?.[key], context);
      if (value === undefined) throw new Error('Unknown rule field: ' + expression.path);
      return value;
    }
    case 'eq': return read(expression.left) === read(expression.right);
    case 'not': return !read(expression.value);
    case 'all': return expression.values.every(value => Boolean(read(value)));
    case 'any': return expression.values.some(value => Boolean(read(value)));
    case 'before': {
      const left = read(expression.left);
      const right = read(expression.right);
      // Unknown timestamps never establish an ordering.
      return left !== null && right !== null && left < right;
    }
    case 'instant': {
      const value = read(expression.value);
      return value === null ? null : Date.parse(value);
    }
    case 'day': {
      const value = read(expression.value);
      return value === null ? null : calendarDate(value);
    }
    case 'otherwise': return read(expression.left) ?? read(expression.right);
    default: throw new Error('Unknown rule expression: ' + expression.op);
  }
}

const FIELDS = {
  'crm.completed': 'CRM.завершено',
  'crm.receivedAt': 'CRM.время_приёмки',
  'crm.documents': 'CRM.документы',
  'crm.managerApproved': 'CRM.согласование',
  'message.signal': 'сообщение.сигнал',
  'message.occurredAt': 'сообщение.время',
  'sources.crm.updatedAt': 'CRM.время_обновления',
  dueAt: 'срок.точное_время',
  dueDate: 'срок.дата',
  asOf: 'снимок.время',
};
const VALUES = {
  missing: 'недостача', delay: 'задержка', received: 'получено',
  incomplete: 'неполный комплект', accepted: 'приняты', pending: 'ожидаются',
};

export function describe(expression) {
  if (expression === true) return 'ДА';
  if (expression === false) return 'НЕТ';
  if (expression === null) return 'НЕИЗВЕСТНО';
  if (typeof expression === 'string') return JSON.stringify(VALUES[expression] ?? expression);
  if (typeof expression !== 'object') return String(expression);
  const show = describe;
  switch (expression.op) {
    case 'field': return FIELDS[expression.path] ?? expression.path;
    case 'eq': return `${show(expression.left)} = ${show(expression.right)}`;
    case 'not': return `НЕ (${show(expression.value)})`;
    case 'all': return expression.values.map(value => `(${show(value)})`).join(' И ');
    case 'any': return expression.values.map(value => `(${show(value)})`).join(' ИЛИ ');
    case 'before': return `${show(expression.left)} < ${show(expression.right)}`;
    case 'instant': return `МОМЕНТ(${show(expression.value)})`;
    case 'day': return `ДЕНЬ_МСК(${show(expression.value)})`;
    case 'otherwise': return `ПЕРВОЕ_ИЗВЕСТНОЕ(${show(expression.left)}, ${show(expression.right)})`;
    default: throw new Error('Unknown rule expression: ' + expression.op);
  }
}
