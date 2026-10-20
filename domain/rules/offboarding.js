import { deadlineReason } from '../deadlines.js';
import { field, eq, all, not } from '../expressions.js';
import { conclusion } from '../decision.js';

export const offboardingRules = [{
  id: "OFFBOARDING.INVALID_COMPLETION",
  title: "Завершение без обязательного согласования — расхождение",
  sourceKeys: ["crm"],
  when: all(eq(field("crm.completed"), true), not(eq(field("crm.managerApproved"), true))),
  then: conclusion("urgent",
    "Процедура отмечена завершённой, но обязательное подтверждение руководителя отсутствует или неизвестно.",
    "Проверить основание завершения и получить подтверждение непосредственно от руководителя.",
    "Разобрать расхождение и исправить запись CRM только после подтверждения.",
    ["Подтверждение руководителя проверено и зафиксировано.", "Основание завершения проверено, расхождение в CRM устранено."]),
}, {
  id: "OFFBOARDING.APPROVAL_MISSING",
  title: "Для увольнения требуется подтверждение руководителя",
  sourceKeys: ["crm", "message"],
  when: not(eq(field("crm.managerApproved"), true)),
  then: conclusion("deadline",
    ({ item, asOf }) => `${deadlineReason(item, asOf)} Подтверждение руководителя в CRM ${item.crm.managerApproved === null ? "неизвестно" : "отсутствует"}.${item.message.signal === "aware" ? " Осведомлённость руководителя со слов сотрудника его не заменяет." : ""}`,
    "Получить подтверждение непосредственно от ответственного руководителя.",
    "Зафиксировать подтверждение и завершить оставшиеся шаги увольнения по регламенту.",
    ["Подтверждение руководителя зафиксировано в CRM.", "Оставшиеся шаги процедуры выполнены; завершение зафиксировано."]),
}, {
  id: "OFFBOARDING.INCOMPLETE",
  title: "Согласование ещё не означает завершение процедуры",
  sourceKeys: ["crm"],
  when: not(eq(field("crm.completed"), true)),
  then: conclusion("deadline",
    ({ item, asOf }) => `${deadlineReason(item, asOf)} Согласование есть, но завершение процедуры ${item.crm.completed === null ? "неизвестно" : "ещё не отмечено"}.`,
    "Проверить оставшиеся шаги процедуры и их сроки.",
    "Завершить процедуру по регламенту и зафиксировать результат в CRM.",
    ["Все оставшиеся шаги процедуры выполнены.", "Завершение процедуры зафиксировано в CRM."]),
}, {
  id: "OFFBOARDING.CONFIRMED",
  title: "Подтверждены и согласование, и завершение",
  sourceKeys: ["crm"],
  when: true,
  then: conclusion("done",
    "Подтверждение руководителя и завершение процедуры зафиксированы в CRM.",
    "Дополнительная задача по этому снимку не требуется.",
    "Отдельную задачу не создавать.",
    ["Согласование и завершение процедуры зафиксированы в CRM."]),
}];
