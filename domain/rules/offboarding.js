import { deadlinePriority, deadlineReason } from '../deadlines.js';
import { sources } from '../evidence.js';
import { conclusion } from '../decision.js';

export function offboardingRules(item, asOf) {
  const ids = sources(item);
  const priority = deadlinePriority(item, asOf);
  const deadline = deadlineReason(item, asOf);
  return [{
    id: "OFFBOARDING.INVALID_COMPLETION",
    title: "Завершение без обязательного согласования — расхождение",
    sourceIds: [ids.crm],
    when: () => item.crm.completed === true && item.crm.managerApproved !== true,
    then: () => conclusion("urgent",
      "Процедура отмечена завершённой, но обязательное подтверждение руководителя отсутствует или неизвестно.",
      "Проверить основание завершения и получить подтверждение непосредственно от руководителя.",
      "Разобрать расхождение и исправить запись CRM только после подтверждения.",
      ["Подтверждение руководителя проверено и зафиксировано.", "Основание завершения проверено, расхождение в CRM устранено."]),
  }, {
    id: "OFFBOARDING.APPROVAL_MISSING",
    title: "Для увольнения требуется подтверждение руководителя",
    sourceIds: [ids.crm, ids.message],
    when: () => item.crm.managerApproved !== true,
    then: () => conclusion(priority,
      `${deadline} Подтверждение руководителя в CRM ${item.crm.managerApproved === null ? "неизвестно" : "отсутствует"}.${item.message.signal === "aware" ? " Осведомлённость руководителя со слов сотрудника его не заменяет." : ""}`,
      "Получить подтверждение непосредственно от ответственного руководителя.",
      "Зафиксировать подтверждение и завершить оставшиеся шаги увольнения по регламенту.",
      ["Подтверждение руководителя зафиксировано в CRM.", "Оставшиеся шаги процедуры выполнены; завершение зафиксировано."]),
  }, {
    id: "OFFBOARDING.INCOMPLETE",
    title: "Согласование ещё не означает завершение процедуры",
    sourceIds: [ids.crm],
    when: () => item.crm.completed !== true,
    then: () => conclusion(priority,
      `${deadline} Согласование есть, но завершение процедуры ${item.crm.completed === null ? "неизвестно" : "ещё не отмечено"}.`,
      "Проверить оставшиеся шаги процедуры и их сроки.",
      "Завершить процедуру по регламенту и зафиксировать результат в CRM.",
      ["Все оставшиеся шаги процедуры выполнены.", "Завершение процедуры зафиксировано в CRM."]),
  }, {
    id: "OFFBOARDING.CONFIRMED",
    title: "Подтверждены и согласование, и завершение",
    sourceIds: [ids.crm],
    when: () => true,
    then: () => conclusion("done",
      "Подтверждение руководителя и завершение процедуры зафиксированы в CRM.",
      "Дополнительная задача по этому снимку не требуется.",
      "Отдельную задачу не создавать.",
      ["Согласование и завершение процедуры зафиксированы в CRM."]),
  }];
}

