import { any, after, instant, field } from '../expressions.js';
import { conclusion } from '../decision.js';

export const dataRules = [{
    id: "DATA.FUTURE_SOURCE",
    title: "Данные после времени снимка нельзя использовать в его выводе",
    sourceKeys: ['crm', 'message'],
    when: any(
      after(instant(field('crm.receivedAt')), instant(field('asOf'))),
      after(instant(field('message.occurredAt')), instant(field('asOf'))),
      after(instant(field('sources.crm.updatedAt')), instant(field('asOf'))),
    ),
    then: conclusion("today",
      "В источниках есть событие позже времени снимка. Сначала нужно проверить даты или выбрать корректное время расчёта.",
      "Сверить время приёмки, сообщения и обновления CRM со временем снимка.",
      "Исправить время или пересчитать сводку на момент, включающий эти события.",
      ["Время событий проверено; все использованные сведения относятся к выбранному снимку."]),
}];
