export function triState(value) {
  if (value === true) return "met";
  if (value === false) return "missing";
  return "unknown";
}

export function sources(item) {
  return { crm: item.sources.crm.id, message: item.sources.message.id };
}

export function delayReceiptOrder(item) {
  if (item.message.occurredAt === null || item.crm.receivedAt === null) return "unknown";
  const difference = Date.parse(item.message.occurredAt) - Date.parse(item.crm.receivedAt);
  if (difference < 0) return "before";
  if (difference > 0) return "after";
  return "same-time";
}

export function isOldDelay(item) {
  return item.message.signal === "delay" && delayReceiptOrder(item) === "before";
}

export function receiptConflictReason(item) {
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

export function requiredChecks(item) {
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
  let consistency = receiptStatus === "met" ? "met" : "unknown";
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

export function dataUncertainties(item) {
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

