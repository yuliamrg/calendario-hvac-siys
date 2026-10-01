import {
  addDaysISO,
  compareISODate,
  dayOfWeek,
  isISODateString,
  makeISODate,
  mondayOnOrAfter,
  parseISODate
} from "./dates.js";
import { normalizeKey, safeText } from "./text.js";

export function easterSunday(year) {
  // Algoritmo gregoriano de Meeus/Jones/Butcher.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return makeISODate(year, month, day);
}
function addHoliday(map, date, name, metadata = {}) {
  const occurrence = {
    ruleId: metadata.ruleId ?? normalizeKey(name),
    label: name,
    nominalDate: metadata.nominalDate ?? date,
    observedDate: date,
    shifted: (metadata.nominalDate ?? date) !== date,
    shiftPolicy: metadata.shiftPolicy ?? "none",
    effectiveFrom: metadata.effectiveFrom ?? null,
    sourceId: metadata.source ?? "Ley 51 de 1983"
  };
  const current = map.get(date);
  if (current) {
    const names = new Set([...current.name.split(" · "), name]);
    current.name = [...names].join(" · ");
    current.sources = [...new Set([...(current.sources ?? []), metadata.source].filter(Boolean))];
    current.occurrences.push(occurrence);
    return;
  }
  map.set(date, {
    date,
    name,
    kind: metadata.kind ?? "national",
    movedFrom: metadata.movedFrom ?? null,
    source: metadata.source ?? "Ley 51 de 1983",
    sources: metadata.source ? [metadata.source] : ["Ley 51 de 1983"],
    occurrences: [occurrence],
    manualClosure: false,
    allowScheduling: false
  });
}

export function colombianHolidays(year, overrides = []) {
  const holidays = new Map();
  const law51 = "Ley 51 de 1983";

  const fixed = [
    ["new_year", 1, 1, "Año Nuevo"],
    ["labor_day", 5, 1, "Día del Trabajo"],
    ["independence_day", 7, 20, "Día de la Independencia"],
    ["boyaca_battle", 8, 7, "Batalla de Boyacá"],
    ["immaculate_conception", 12, 8, "Inmaculada Concepción"],
    ["christmas", 12, 25, "Navidad"]
  ];
  for (const [ruleId, month, day, name] of fixed) {
    const nominalDate = makeISODate(year, month, day);
    addHoliday(holidays, nominalDate, name, { source: law51, ruleId, nominalDate });
  }

  const moved = [
    ["epiphany", 1, 6, "Día de los Reyes Magos"],
    ["saint_joseph", 3, 19, "Día de San José"],
    ["saints_peter_paul", 6, 29, "San Pedro y San Pablo"],
    ["assumption", 8, 15, "Asunción de la Virgen"],
    ["october_12", 10, 12, "Día de la Raza"],
    ["all_saints", 11, 1, "Todos los Santos"],
    ["cartagena_independence", 11, 11, "Independencia de Cartagena"]
  ];
  for (const [ruleId, month, day, name] of moved) {
    const original = makeISODate(year, month, day);
    addHoliday(holidays, mondayOnOrAfter(original), name, {
      source: law51,
      movedFrom: original,
      ruleId,
      nominalDate: original,
      shiftPolicy: "next-or-same-monday"
    });
  }

  const easter = easterSunday(year);
  const holyThursday = addDaysISO(easter, -3);
  const goodFriday = addDaysISO(easter, -2);
  addHoliday(holidays, holyThursday, "Jueves Santo", {
    source: law51,
    ruleId: "holy_thursday",
    nominalDate: holyThursday
  });
  addHoliday(holidays, goodFriday, "Viernes Santo", {
    source: law51,
    ruleId: "good_friday",
    nominalDate: goodFriday
  });

  const relativeMoved = [
    ["ascension", 39, "Ascensión del Señor"],
    ["corpus_christi", 60, "Corpus Christi"],
    ["sacred_heart", 68, "Sagrado Corazón de Jesús"]
  ];
  for (const [ruleId, offset, name] of relativeMoved) {
    const original = addDaysISO(easter, offset);
    addHoliday(holidays, mondayOnOrAfter(original), name, {
      source: law51,
      movedFrom: original,
      ruleId,
      nominalDate: original,
      shiftPolicy: "next-or-same-monday"
    });
  }

  if (year >= 2026) {
    const original = makeISODate(year, 7, 9);
    addHoliday(holidays, mondayOnOrAfter(original), "Nuestra Señora del Rosario de Chiquinquirá", {
      source: "Ley 2578 de 2026",
      movedFrom: original,
      ruleId: "chiquinquira",
      nominalDate: original,
      shiftPolicy: "next-or-same-monday",
      effectiveFrom: "2026-06-02"
    });
  }

  for (const override of overrides) {
    if (
      !override ||
      override.active === false ||
      !isISODateString(override.date) ||
      Number(override.date.slice(0, 4)) !== year
    ) {
      continue;
    }
    try {
      parseISODate(override.date);
    } catch {
      continue;
    }
    const type = override.type ?? (override.action === "remove" ? "allow-scheduling" : "manual-closure");
    if (!["allow-scheduling", "manual-closure"].includes(type)) continue;
    if (type === "allow-scheduling") {
      const current = holidays.get(override.date) ?? {
        date: override.date,
        name: safeText(override.name, 120) || "Programación habilitada manualmente",
        kind: "manual",
        movedFrom: null,
        source: "Ajuste manual",
        sources: ["Ajuste manual"],
        occurrences: [],
        manualClosure: false,
        allowScheduling: false
      };
      current.allowScheduling = true;
      current.overrideLabel = safeText(override.name, 120) || "Programación habilitada manualmente";
      holidays.set(override.date, current);
      continue;
    }
    addHoliday(holidays, override.date, safeText(override.name, 120) || "Festivo manual", {
      kind: "manual",
      source: "Ajuste manual",
      ruleId: `manual_${override.id ?? normalizeKey(override.name)}`,
      nominalDate: override.date
    });
    holidays.get(override.date).manualClosure = true;
  }

  return [...holidays.values()].sort((a, b) => compareISODate(a.date, b.date));
}

export function holidayMapForYears(years, overrides = []) {
  const map = new Map();
  for (const year of new Set(years)) {
    for (const holiday of colombianHolidays(year, overrides)) {
      map.set(holiday.date, holiday);
    }
  }
  return map;
}

export function holidayMapForRange(startDate, endDate, overrides = []) {
  parseISODate(startDate);
  parseISODate(endDate);
  if (compareISODate(endDate, startDate) < 0) {
    throw new RangeError("La fecha final no puede ser anterior a la inicial.");
  }
  const firstYear = Number(startDate.slice(0, 4));
  const lastYear = Number(endDate.slice(0, 4));
  const years = [];
  for (let year = firstYear; year <= lastYear; year += 1) years.push(year);
  return holidayMapForYears(years, overrides);
}

export function isNonWorkingDate(date, holidayMap) {
  const holiday = holidayMap.get(date);
  const hasHoliday = Boolean(holiday?.occurrences?.length || holiday?.manualClosure);
  return (dayOfWeek(date) === 0 || hasHoliday) && !holiday?.allowScheduling;
}

export function generateSeriesDates(startDate, endDate, holidayMap, options = false) {
  parseISODate(startDate);
  parseISODate(endDate);
  if (compareISODate(endDate, startDate) < 0) {
    throw new RangeError("La fecha final no puede ser anterior a la inicial.");
  }
  const normalizedOptions = typeof options === "boolean"
    ? { includeAllNonWorking: options, forceIncludeDates: [] }
    : {
      includeAllNonWorking: Boolean(options?.includeAllNonWorking ?? options?.includeNonWorking),
      forceIncludeDates: Array.isArray(options?.forceIncludeDates) ? options.forceIncludeDates : []
    };
  const forceInclude = new Set(normalizedOptions.forceIncludeDates);
  for (const date of forceInclude) parseISODate(date);
  const included = [];
  const omitted = [];
  for (let date = startDate; compareISODate(date, endDate) <= 0; date = addDaysISO(date, 1)) {
    const holiday = holidayMap.get(date);
    const sunday = dayOfWeek(date) === 0;
    const nonWorking = isNonWorkingDate(date, holidayMap);
    if (!normalizedOptions.includeAllNonWorking && !forceInclude.has(date) && nonWorking) {
      const reasons = [];
      if (sunday) reasons.push({ type: "sunday", label: "Domingo" });
      for (const occurrence of holiday?.occurrences ?? []) {
        reasons.push({
          type: occurrence.sourceId === "Ajuste manual" ? "manual-closure" : "legal-holiday",
          ruleId: occurrence.ruleId,
          label: occurrence.label
        });
      }
      omitted.push({
        date,
        reason: reasons.map((item) => item.label).join(" · ") || "Día no laborable",
        reasons
      });
    } else {
      included.push(date);
    }
  }
  return { included, omitted };
}
