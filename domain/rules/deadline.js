import { field, instant, day, otherwise, before, eq } from '../expressions.js';

const dueDay = otherwise(field('dueDate'), day(field('dueAt')));
const snapshotDay = day(field('asOf'));

export const deadlineRules = [{
  id: "DEADLINE.OVERDUE_TIME",
  title: "Точный срок уже прошёл",
  when: before(instant(field('dueAt')), instant(field('asOf'))),
  then: { priority: 'urgent' },
}, {
  id: "DEADLINE.UNKNOWN",
  title: "Отсутствующий срок нужно уточнить",
  when: eq(dueDay, null),
  then: { priority: 'today' },
}, {
  id: "DEADLINE.OVERDUE_DATE",
  title: "Дата операции уже прошла",
  when: before(dueDay, snapshotDay),
  then: { priority: 'urgent' },
}, {
  id: "DEADLINE.TODAY",
  title: "Операция запланирована на день снимка",
  when: eq(dueDay, snapshotDay),
  then: { priority: 'today' },
}, {
  id: "DEADLINE.FUTURE",
  title: "Срок впереди",
  when: true,
  then: { priority: 'before-start' },
}];
