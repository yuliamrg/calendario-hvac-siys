const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isISODateString(value) {
  return ISO_DATE_PATTERN.test(String(value));
}

export function parseISODate(value) {
  if (!isISODateString(value)) {
    throw new TypeError(`Fecha inválida: ${value}`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new TypeError(`Fecha inexistente: ${value}`);
  }
  return date;
}

export function toISODate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function makeISODate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new TypeError("La fecha debe contener números enteros.");
  }
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  parseISODate(value);
  return value;
}

export function addDaysISO(value, days) {
  const date = parseISODate(value);
  date.setUTCDate(date.getUTCDate() + Number(days));
  return toISODate(date);
}

export function differenceInDays(from, to) {
  return Math.round((parseISODate(to) - parseISODate(from)) / 86400000);
}

export function compareISODate(left, right) {
  return String(left).localeCompare(String(right));
}

export function dayOfWeek(value) {
  return parseISODate(value).getUTCDay();
}

export function mondayOnOrAfter(value) {
  const weekday = dayOfWeek(value);
  const daysUntilMonday = weekday === 1 ? 0 : (8 - weekday) % 7;
  return addDaysISO(value, daysUntilMonday);
}

export function startOfMondayWeek(value) {
  const weekday = dayOfWeek(value);
  const daysSinceMonday = weekday === 0 ? -6 : 1 - weekday;
  return addDaysISO(value, daysSinceMonday);
}

export function endOfMonthISO(year, month) {
  return toISODate(new Date(Date.UTC(year, month, 0)));
}

export function monthGridDates(year, month) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError("Mes o año inválido.");
  }
  const firstDay = makeISODate(year, month, 1);
  const gridStart = startOfMondayWeek(firstDay);
  return Array.from({ length: 42 }, (_, index) => addDaysISO(gridStart, index));
}

export function todayInBogota(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const dateParts = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}
