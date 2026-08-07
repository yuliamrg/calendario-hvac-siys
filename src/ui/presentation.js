import { parseISODate } from "../domain/dates.js";
import { safeText } from "../domain/text.js";

export function createElement(tagName, className = "", text = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== "") element.textContent = text;
  return element;
}

export function setChildren(parent, ...children) {
  parent.replaceChildren(...children.filter(Boolean));
  return parent;
}

export function option(value, label) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

export function formatDisplayDate(value, options = {}) {
  const date = parseISODate(value);
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "UTC",
    day: options.day ?? "numeric",
    month: options.month ?? "long",
    year: options.year ?? "numeric",
    weekday: options.weekday
  }).format(date);
}

export function formatMonthTitle(year, month) {
  const label = new Intl.DateTimeFormat("es-CO", {
    timeZone: "UTC",
    month: "long",
    year: "numeric"
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

export function timestampLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return safeText(value, 80);
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export function displayInitialsFor(name) {
  return safeText(name, 160)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
