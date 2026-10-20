const TIME_ZONE = "Europe/Moscow";

export function calendarDate(timestamp) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const part = (name) => parts.find((value) => value.type === name).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function displayTime(timestamp) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: TIME_ZONE, day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(timestamp)) + " МСК";
}

export function displayDate(date) {
  return date.split("-").reverse().join(".");
}

/** Date-only deadlines never acquire an invented hour. */
export function deadlinePriority(item, asOf) {
  if (item.dueAt && Date.parse(item.dueAt) < Date.parse(asOf)) return "urgent";
  const dueDay = item.dueDate ?? (item.dueAt ? calendarDate(item.dueAt) : null);
  if (!dueDay) return "today";
  const today = calendarDate(asOf);
  if (dueDay < today) return "urgent";
  if (dueDay === today) return "today";
  return "before-start";
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

