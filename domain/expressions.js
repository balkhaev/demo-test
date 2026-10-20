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

export { describe } from './rule-language.js';
