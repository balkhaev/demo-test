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

