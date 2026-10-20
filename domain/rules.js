import { validateSnapshot } from "./validation.js";

export const RULES_VERSION = "2.0.0";

const PRIORITY_ORDER = { urgent: 0, today: 1, "before-start": 2, done: 3 };
const STATUS_LABELS = {
  urgent: "Проверить сейчас",
  today: "Решить сегодня",
  "before-start": "До срока",
  done: "Без вмешательства",
};
const TIME_ZONE = "Europe/Moscow";

function calendarDate(timestamp) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const part = (name) => parts.find((value) => value.type === name).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function displayTime(timestamp) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: TIME_ZONE, day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(timestamp)) + " МСК";
}

function displayDate(date) {
  return date.split("-").reverse().join(".");
}

/** Date-only deadlines never acquire an invented hour. */
function deadlinePriority(item, asOf) {
  if (item.dueAt && Date.parse(item.dueAt) < Date.parse(asOf)) return "urgent";
  const dueDay = item.dueDate ?? (item.dueAt ? calendarDate(item.dueAt) : null);
  if (!dueDay) return "today";
  const today = calendarDate(asOf);
  if (dueDay < today) return "urgent";
  if (dueDay === today) return "today";
  return "before-start";
}

function deadlineReason(item, asOf) {
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

function triState(value) {
  if (value === true) return "met";
  if (value === false) return "missing";
  return "unknown";
}

function sources(item) {
  return { crm: item.sources.crm.id, message: item.sources.message.id };
}

function delayReceiptOrder(item) {
  if (item.message.occurredAt === null || item.crm.receivedAt === null) return "unknown";
  const difference = Date.parse(item.message.occurredAt) - Date.parse(item.crm.receivedAt);
  if (difference < 0) return "before";
  if (difference > 0) return "after";
  return "same-time";
}

function isOldDelay(item) {
  return item.message.signal === "delay" && delayReceiptOrder(item) === "before";
}

function receiptConflictReason(item) {
  if (item.crm.receivedAt === null) {
    return "В CRM поставка отмечена завершённой, но время приёмки отсутствует. Порядок приёмки и сообщения о задержке не установлен.";
  }
  if (item.message.occurredAt === null) {
    return "В CRM поставка завершена, но есть сообщение о задержке без времени. Нельзя установить, было оно до или после приёмки.";
  }
  if (delayReceiptOrder(item) === "same-time") {
    return "Время сообщения о задержке совпадает с временем приёмки. Порядок событий не установлен; нужна проверка источников.";
  }
  return "После указанной приёмки есть сообщение о задержке. Источники противоречат друг другу.";
}

function requiredChecks(item) {
  const ids = sources(item);
  if (item.kind === "onboarding") {
    return [{
      id: "documents-accepted",
      label: "Полный комплект документов принят в CRM",
      status: item.crm.documents === null ? "unknown" : item.crm.documents === "accepted" ? "met" : "missing",
      sourceIds: [ids.crm],
    }, {
      id: "documents-consistency",
      label: "Нет сообщения о неполном комплекте",
      status: item.message.signal === "missing" ? "missing" : "met",
      sourceIds: [ids.message],
    }];
  }
  if (item.kind === "offboarding") {
    return [{
      id: "manager-approval",
      label: "Подтверждение руководителя зафиксировано в CRM",
      status: triState(item.crm.managerApproved),
      sourceIds: [ids.crm],
    }, {
      id: "procedure-completed",
      label: "Завершение процедуры зафиксировано в CRM",
      status: triState(item.crm.completed),
      sourceIds: [ids.crm],
    }];
  }
  const receiptStatus = item.crm.completed === false ? "missing"
    : item.crm.completed === true && item.crm.receivedAt ? "met" : "unknown";
  let consistency = "met";
  if (item.message.signal === "missing") consistency = "missing";
  else if (item.crm.completed && item.message.signal === "delay" && !isOldDelay(item)) {
    consistency = delayReceiptOrder(item) === "after" ? "missing" : "unknown";
  }
  return [{
    id: "receipt-recorded",
    label: "Приёмка и время получения подтверждены в CRM",
    status: receiptStatus,
    sourceIds: [ids.crm],
  }, {
    id: "delivery-consistency",
    label: "Нет актуального расхождения между приёмкой и перепиской",
    status: consistency,
    sourceIds: [ids.crm, ids.message],
  }];
}

function dataUncertainties(item) {
  const warnings = [];
  if (item.message.occurredAt === null) warnings.push({
    code: "MESSAGE_TIME_UNKNOWN",
    text: "Время сообщения не указано. Его давность нельзя установить по снимку.",
  });
  if (item.sources.crm.updatedAt === null) warnings.push({
    code: "CRM_UPDATE_TIME_UNKNOWN",
    text: "Время обновления CRM не указано. Перед действием нужна проверка актуальности записи.",
  });
  if (item.kind === "onboarding" && item.crm.documents === null) warnings.push({
    code: "DOCUMENT_STATUS_UNKNOWN",
    text: "Статус документов отсутствует. Отсутствие сведений не равно принятому комплекту.",
  });
  if (item.kind === "offboarding" && item.crm.managerApproved === null) warnings.push({
    code: "APPROVAL_UNKNOWN",
    text: "Наличие подтверждения руководителя неизвестно; слова сотрудника не заполняют это поле.",
  });
  if ((item.kind === "offboarding" || item.kind === "delivery") && item.crm.completed === null) warnings.push({
    code: "COMPLETION_UNKNOWN",
    text: "Статус завершения неизвестен. Операцию нельзя считать завершённой.",
  });
  if (item.kind === "delivery" && item.crm.completed === true && item.crm.receivedAt === null) warnings.push({
    code: "RECEIPT_TIME_UNKNOWN",
    text: "Время приёмки отсутствует. Нельзя сопоставить приёмку с сообщениями по времени.",
  });
  if (item.kind === "delivery" && item.crm.completed === true && item.message.signal === "delay" && delayReceiptOrder(item) === "same-time") warnings.push({
    code: "EVENT_ORDER_UNKNOWN",
    text: "Времена приёмки и сообщения совпадают. Эта точность времени не позволяет установить порядок событий.",
  });
  return warnings;
}

function conclusion(priority, reason, check, action, closureConditions) {
  return { priority, reason, check, action, closureConditions };
}

/**
 * Only predicates actually evaluated appear in the trace.
 * First matching rule wins; IDs remain stable for UI explanations and tests.
 */
function runRules(rules, trace) {
  for (const rule of rules) {
    const matched = Boolean(rule.when());
    trace.push({ ruleId: rule.id, title: rule.title, matched, sourceIds: rule.sourceIds });
    if (matched) return { ...rule.then(), ruleId: rule.id };
  }
  throw new Error("Domain rules must include a fallback");
}

function deliveryRules(item, asOf) {
  const { crm, message } = item;
  const ids = sources(item);
  const deadline = deadlineReason(item, asOf);
  const priority = deadlinePriority(item, asOf);
  return [{
    id: "DELIVERY.SHORTAGE",
    title: "Сообщение о недостаче важнее завершённого статуса",
    sourceIds: [ids.crm, ids.message],
    when: () => message.signal === "missing",
    then: () => conclusion("urgent",
      "Получатель сообщает о недостаче. Даже статус «Принято» не снимает расхождение.",
      "Сопоставить фактическое количество с документами и записью приёмки; уточнить время сообщения.",
      "Связаться с получателем и ответственным за поставку, зафиксировать и разобрать расхождение.",
      ["Количество сверено с документами и результат зафиксирован.", "Сообщение о недостаче проверено, расхождение урегулировано."]),
  }, {
    id: "DELIVERY.RECEIPT_CONFLICT",
    title: "Завершение и задержка требуют проверки порядка событий",
    sourceIds: [ids.crm, ids.message],
    when: () => crm.completed === true && message.signal === "delay" && !isOldDelay(item),
    then: () => conclusion("urgent",
      receiptConflictReason(item),
      "Проверить время сообщения и приёмки, автора и актуальное состояние поставки.",
      "Уточнить состояние у получателя и устранить расхождение после проверки.",
      ["Порядок событий установлен по времени и источникам.", "Фактическая приёмка подтверждена, противоречие объяснено или исправлено."]),
  }, {
    id: "DELIVERY.CONFIRMED",
    title: "Приёмка подтверждена и актуальных противоречий нет",
    sourceIds: [ids.crm, ids.message],
    when: () => crm.completed === true && crm.receivedAt !== null,
    then: () => conclusion("done",
      `Приёмка подтверждена в CRM: ${displayTime(crm.receivedAt)}. ${isOldDelay(item) ? "Сообщение о задержке датировано раньше приёмки и не описывает текущее состояние." : message.signal === "received" ? "Получатель также сообщает о получении." : "Противоречащих сведений в предоставленных данных нет."}`,
      "Дополнительная задача по этому снимку не требуется.",
      "Отдельную задачу не создавать.",
      ["Приёмка подтверждена в CRM.", "Нет неразобранного сообщения о недостаче или актуальной задержке."]),
  }, {
    id: "DELIVERY.RECEIPT_INCOMPLETE",
    title: "Одного завершённого статуса без времени приёмки недостаточно",
    sourceIds: [ids.crm],
    when: () => crm.completed === true,
    then: () => conclusion(priority,
      `${deadline} В CRM указан завершённый статус, но время подтверждённой приёмки отсутствует.`,
      "Проверить у получателя факт и время приёмки по принятому регламенту.",
      "После проверки добавить подтверждение приёмки в CRM.",
      ["Факт и время приёмки подтверждены и зафиксированы в CRM."]),
  }, {
    id: "DELIVERY.DELAY",
    title: "Политика демо: заявленную задержку проверяем сразу",
    sourceIds: [ids.crm, ids.message],
    when: () => message.signal === "delay",
    then: () => conclusion("urgent",
      `${message.notBefore ? "По сообщению курьера доставка возможна не раньше " + message.notBefore + ". Это нижняя граница из сообщения, не согласованный новый срок." : "Курьер сообщает о задержке, но не указывает ожидаемое время."} По политике демо сообщение о задержке требует проверки сейчас, даже если плановый срок ещё не наступил.`,
      "Уточнить актуальность сообщения, ожидаемое время и возможность приёмки на точке.",
      "Связаться с курьером и получателем, согласовать новый срок и зафиксировать его в CRM.",
      ["Новый срок согласован с курьером и получателем и зафиксирован в CRM.", "После доставки подтверждены факт и время приёмки."]),
  }, {
    id: "DELIVERY.REPORTED_RECEIPT",
    title: "Сообщение о получении не подменяет приёмку в CRM",
    sourceIds: [ids.crm, ids.message],
    when: () => message.signal === "received",
    then: () => conclusion(priority,
      `${deadline} Получатель сообщает о получении, но приёмка в CRM не подтверждена.`,
      "Проверить факт получения, количество и время по принятому регламенту.",
      "После проверки зафиксировать приёмку в CRM.",
      ["Факт, количество и время приёмки проверены.", "Результат приёмки зафиксирован в CRM."]),
  }, {
    id: "DELIVERY.REVIEW",
    title: "Недостаточные сведения требуют проверки",
    sourceIds: [ids.crm, ids.message],
    when: () => true,
    then: () => conclusion(priority,
      `${deadline} Подтверждённой приёмки нет; данных о фактическом получении недостаточно.`,
      "Уточнить текущий статус поставки и получение на точке.",
      "Получить подтверждение у ответственного и обновить запись CRM после проверки.",
      ["Факт и время приёмки подтверждены и зафиксированы в CRM."]),
  }];
}

function onboardingRules(item, asOf) {
  const ids = sources(item);
  const priority = deadlinePriority(item, asOf);
  const deadline = deadlineReason(item, asOf);
  return [{
    id: "ONBOARDING.DOCUMENT_GAP",
    title: "Неполный комплект остаётся препятствием для оформления",
    sourceIds: [ids.crm, ids.message],
    when: () => item.crm.documents === "incomplete" || item.message.signal === "missing",
    then: () => conclusion(priority,
      `${deadline} Есть сведения о неполном комплекте документов.`,
      "Уточнить перечень недостающих документов или исправлений; при расхождении проверить оба источника.",
      "Запросить недостающее и подтвердить принятие полного комплекта до первого выхода.",
      ["Полный комплект проверен и принят.", "Принятие зафиксировано в CRM; сообщение о недостаче проверено."]),
  }, {
    id: "ONBOARDING.DOCUMENTS_ACCEPTED",
    title: "Принятые документы снимают препятствие из данного снимка",
    sourceIds: [ids.crm, ids.message],
    when: () => item.crm.documents === "accepted",
    then: () => conclusion("done",
      "Документы приняты в CRM. Других препятствий для первого выхода в предоставленных данных нет.",
      "Дополнительная задача по этому снимку не требуется.",
      "Не создавать задачу только из-за запланированного первого выхода.",
      ["Полный комплект принят в CRM.", "Нет неразобранного сообщения о неполном комплекте."]),
  }, {
    id: "ONBOARDING.DOCUMENTS_PENDING",
    title: "Ожидаемые документы требуют подтверждения принятия",
    sourceIds: [ids.crm, ids.message],
    when: () => item.crm.documents === "pending",
    then: () => conclusion(priority,
      `${deadline} В CRM документы ожидаются. ${item.message.signal === "sent" ? "Сообщение об отправке фотографий не подтверждает получение и принятие." : "В переписке нет подтверждающих сведений о принятии документов."}`,
      "Проверить у руководителя получение, комплектность и пригодность документов.",
      "Обеспечить передачу по принятому каналу, запросить недостающее и обновить CRM после проверки.",
      ["Получение и пригодность документов проверены.", "Полный комплект принят и это зафиксировано в CRM."]),
  }, {
    id: "ONBOARDING.DOCUMENTS_UNKNOWN",
    title: "Неизвестный статус документов нельзя считать принятием",
    sourceIds: [ids.crm],
    when: () => true,
    then: () => conclusion(priority,
      `${deadline} В CRM нет достоверного статуса документов.`,
      "Уточнить наличие полного комплекта и результат его проверки у ответственного.",
      "Восстановить подтверждённый статус документов в CRM.",
      ["Полный комплект проверен и принят, статус зафиксирован в CRM."]),
  }];
}

function offboardingRules(item, asOf) {
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

const RULE_SETS = {
  delivery: deliveryRules,
  onboarding: onboardingRules,
  offboarding: offboardingRules,
};

function evaluateValidatedCase(item, asOf) {
  const inputSnapshot = structuredClone(item);
  const trace = [];
  const uncertainties = dataUncertainties(inputSnapshot);
  const ids = sources(item);
  const futureSources = [
    ["receipt-time", item.crm.receivedAt],
    ["message-time", item.message.occurredAt],
    ["crm-update-time", item.sources.crm.updatedAt],
  ].filter(([, time]) => time !== null && Date.parse(time) > Date.parse(asOf));
  const dataRule = {
    id: "DATA.FUTURE_SOURCE",
    title: "Данные после времени снимка нельзя использовать в его выводе",
    sourceIds: [ids.crm, ids.message],
    when: () => futureSources.length > 0,
    then: () => conclusion("today",
      "В источниках есть событие позже времени снимка. Сначала нужно проверить даты или выбрать корректное время расчёта.",
      "Сверить время приёмки, сообщения и обновления CRM со временем снимка.",
      "Исправить время или пересчитать сводку на момент, включающий эти события.",
      ["Время событий проверено; все использованные сведения относятся к выбранному снимку."]),
  };
  const result = runRules([dataRule, ...RULE_SETS[item.kind](inputSnapshot, asOf)], trace);
  if (futureSources.length > 0) uncertainties.push({
    code: "SOURCE_AFTER_SNAPSHOT",
    text: "События после выбранного времени снимка требуют ручной проверки дат.",
  });
  if (result.priority !== "done" && !item.dueAt && !item.dueDate) {
    uncertainties.push({ code: "DEADLINE_UNKNOWN", text: "Срок операции не указан; срочность по времени нельзя подтвердить." });
  }
  const checks = requiredChecks(inputSnapshot);
  if (futureSources.length > 0) {
    for (const check of checks) if (check.status === "met") check.status = "unknown";
  }
  return {
    ...structuredClone(inputSnapshot),
    ...result,
    needsAttention: result.priority !== "done",
    statusLabel: item.kind === "onboarding" && result.priority === "before-start"
      ? "До первого выхода" : STATUS_LABELS[result.priority],
    checks,
    trace,
    uncertainties,
    inputSnapshot,
  };
}

/** Pure single-case use case: no network, mutation, model calls or system clock. */
export function evaluateCase(item, asOf) {
  validateSnapshot({ cases: [item], asOf });
  return evaluateValidatedCase(item, asOf);
}

/** Equal priorities retain input order; caller supplies an explicit snapshot time. */
export function buildSummary(cases, asOf) {
  validateSnapshot({ cases, asOf });
  return cases.map((item) => evaluateValidatedCase(item, asOf))
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}
