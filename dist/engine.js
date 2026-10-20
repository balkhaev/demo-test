/** Pure, deterministic rules. No network calls, model calls or current clock. */
const PRIORITY_ORDER = { urgent: 0, today: 1, "before-start": 2, done: 3 };
const STATUS_LABELS = {
  urgent: "Проверить сейчас",
  today: "Решить сегодня",
  "before-start": "До первого выхода",
  done: "Без вмешательства",
};

function decision(priority, reason, check, action) {
  return { priority, needsAttention: priority !== "done", statusLabel: STATUS_LABELS[priority], reason, check, action };
}

function delivery({ crm, message }) {
  if (message.signal === "missing") {
    return decision("urgent", "Получатель сообщает о недостаче. Даже статус «Принято» не снимает расхождение.",
      "Сопоставить фактическое количество с документами и записью приёмки.",
      "Связаться с получателем и ответственным за поставку; зафиксировать и разобрать расхождение.");
  }
  if (crm.completed && message.signal === "delay") {
    return decision("urgent", "В CRM поставка завершена, а в переписке есть сообщение о задержке. Время сообщения не указано.",
      "Проверить время сообщения и приёмки: сообщение могло устареть.",
      "Уточнить актуальное состояние у получателя и устранить расхождение после проверки.");
  }
  if (crm.completed && crm.receivedAt) {
    return decision("done", `Приёмка подтверждена в CRM в ${crm.receivedAt}.${message.signal === "received" ? " Получатель также подтверждает получение." : " Противоречащих сведений нет."}`,
      "Дополнительная проверка по предоставленным данным не требуется.", "Отдельную задачу не создавать.");
  }
  if (crm.completed) {
    return decision("today", "В CRM указан завершённый статус, но подтверждение приёмки не заполнено.",
      "Проверить подтверждение приёмки у получателя.", "После проверки добавить подтверждение приёмки в CRM.");
  }
  if (message.signal === "delay") {
    const time = message.notBefore ? `не раньше ${message.notBefore}` : "позже планового срока";
    return decision("urgent", `По сообщению курьера доставка возможна ${time}. Это сообщение о задержке, а не согласованный новый срок.`,
      "Уточнить ожидаемое время и возможность приёмки на точке.",
      "Связаться с курьером и получателем, согласовать новый срок и зафиксировать его в CRM.");
  }
  if (message.signal === "received") {
    return decision("today", "Получатель сообщает о получении, но приёмка в CRM ещё не подтверждена.",
      "Проверить получение и количество по принятому регламенту.",
      "После проверки зафиксировать приёмку в CRM.");
  }
  return decision("today", "Приёмка в CRM не подтверждена; данных о фактическом получении недостаточно.",
    "Уточнить текущий статус доставки и получение на точке.", "Получить подтверждение у ответственного и обновить запись CRM.");
}

function onboarding({ crm, message }) {
  if (crm.documents === "incomplete" || message.signal === "missing") {
    return decision("before-start", "Есть сведения о неполном комплекте документов; первый выход — завтра.",
      "Уточнить, каких документов или исправлений не хватает.", "Запросить недостающее сегодня и подтвердить принятие полного комплекта до первого выхода.");
  }
  if (crm.documents === "accepted") {
    return decision("done", "Документы приняты в CRM. Других препятствий для первого выхода в данных нет.",
      "Дополнительная проверка по предоставленным данным не требуется.", "Не создавать задачу только из-за запланированного первого выхода.");
  }
  return decision("before-start", "В CRM документы ожидаются. Сообщение об отправке фотографий не подтверждает их получение и принятие.",
    "Проверить у руководителя получение, комплектность и пригодность документов.",
    "Обеспечить передачу по принятому каналу, запросить недостающее сегодня и обновить CRM после проверки.");
}

function offboarding({ crm }) {
  if (!crm.managerApproved) {
    return decision("today", "Последний рабочий день — сегодня. Подтверждения руководителя в CRM нет; слова сотрудника его не заменяют.",
      "Получить подтверждение непосредственно от ответственного руководителя.",
      "Зафиксировать подтверждение и завершить оставшиеся шаги увольнения по регламенту.");
  }
  if (!crm.completed) {
    return decision("today", "Подтверждение руководителя получено, но завершение увольнения ещё не отмечено.",
      "Проверить оставшиеся шаги процедуры и их сроки.", "Завершить процедуру по регламенту и зафиксировать результат в CRM.");
  }
  return decision("done", "Подтверждение руководителя и завершение процедуры зафиксированы в CRM.",
    "Дополнительная проверка по предоставленным данным не требуется.", "Отдельную задачу не создавать.");
}

const RULES = { delivery, onboarding, offboarding };

/** Snapshots source evidence; equal-priority cases retain input order. */
export function buildSummary(cases) {
  if (!Array.isArray(cases)) throw new TypeError("Cases must be an array");
  return cases.map((item) => {
    if (!item?.id || !item.crm || !item.message || !Object.hasOwn(RULES, item.kind)) {
      throw new TypeError("Each case needs an id, a supported kind, CRM data and a message");
    }
    const snapshot = { ...item, crm: { ...item.crm }, message: { ...item.message } };
    return { ...snapshot, ...RULES[snapshot.kind](snapshot) };
  }).sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}
