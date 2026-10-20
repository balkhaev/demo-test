import { calendarDate, displayDate, displayTime } from './dates.js';
import { deadlineRules } from './rules/deadline.js';
import { selectRule } from './rule-engine.js';
export { calendarDate, displayDate, displayTime } from './dates.js';

/** Date-only deadlines never acquire an invented hour. */
export function deadlinePriority(item, asOf) {
  return selectRule(deadlineRules, { ...item, asOf }).then.priority;
}

export function deadlineReason(item, asOf) {
  if (item.dueAt) {
    const tense = Date.parse(item.dueAt) < Date.parse(asOf) ? "Плановый срок уже прошёл" : "Плановый срок";
    return `${tense}: ${displayTime(item.dueAt)}.`;
  }
  if (!item.dueDate) return "Срок операции не указан; его нужно уточнить.";
  const today = calendarDate(asOf);
  if (item.dueDate < today) return `Дата операции уже прошла: ${displayDate(item.dueDate)}.`;
  if (item.dueDate === today) return "Операция запланирована на сегодня; точный час не задан.";
  return `Операция запланирована на ${displayDate(item.dueDate)}; точный час не задан.`;
}

