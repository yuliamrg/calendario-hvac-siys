import test from "node:test";
import assert from "node:assert/strict";

import { ACTIVITY_STATUSES, RESPONSIBLE_TYPES } from "../src/domain/calendar-enums.js";
import {
  ACTIVITY_STATUS_PRESENTATION,
  activityObservationsTooltip,
  activityResponsiblePresentation,
  activityStatusPresentation,
  buildActivityPresentation
} from "../src/ui/activity-presentation.js";

test("el contrato conserva todos los estados y una sola representación de in_progress", () => {
  assert.deepEqual(
    Object.keys(ACTIVITY_STATUS_PRESENTATION).sort(),
    Object.keys(ACTIVITY_STATUSES).sort()
  );

  for (const [key, label] of Object.entries(ACTIVITY_STATUSES)) {
    const presentation = ACTIVITY_STATUS_PRESENTATION[key];
    assert.equal(presentation.key, key);
    assert.equal(presentation.label, label);
    assert.equal(presentation.accessibleLabel, `Estado: ${label}`);
    assert.equal(presentation.variant, key.replaceAll("_", "-"));
    assert.equal(activityStatusPresentation(key), presentation);
  }

  assert.deepEqual(ACTIVITY_STATUS_PRESENTATION.in_progress, {
    key: "in_progress",
    label: "En ejecución",
    icon: "▶",
    accessibleLabel: "Estado: En ejecución",
    variant: "in-progress"
  });
  assert.equal(Object.isFrozen(ACTIVITY_STATUS_PRESENTATION.in_progress), true);
});

test("el tooltip de actividad sólo expone observaciones", () => {
  assert.equal(
    activityObservationsTooltip({
      status: "completed",
      serviceType: "preventive",
      observations: "  Revisar filtro  "
    }),
    "Observaciones: Revisar filtro"
  );
  assert.equal(activityObservationsTooltip({ observations: "   " }), "Sin observaciones registradas");
  assert.equal(activityObservationsTooltip({}), "Sin observaciones registradas");
});

test("una actividad sin responsables conserva un resumen accesible y estable", () => {
  const activity = { responsibleIds: [], status: "scheduled", observations: "" };
  const presentation = buildActivityPresentation(activity);

  assert.deepEqual(presentation.responsibles.fullNames, []);
  assert.deepEqual(presentation.responsibles.initials, []);
  assert.equal(presentation.responsibles.summary, "Sin responsable");
  assert.equal(presentation.responsibles.accessibleLabel, "Sin responsable");
  assert.equal(presentation.responsibles.visualVariant, "unassigned");
  assert.equal(presentation.observationsTooltip, "Sin observaciones registradas");
  assert.match(presentation.accessibleLabel, /sin responsable/);
});

test("los responsables reutilizan nombre completo, iniciales y variante visual", () => {
  const catalog = new Map([
    ["payroll-1", {
      id: "payroll-1",
      name: "Ana Técnica",
      initials: "AT",
      responsibleType: "payroll"
    }],
    ["contractor-1", {
      id: "contractor-1",
      name: "Carlos Contratista",
      responsibleType: "contractor"
    }]
  ]);
  const activity = { responsibleIds: ["payroll-1", "missing", "contractor-1"] };
  const presentation = activityResponsiblePresentation(activity, catalog);

  assert.deepEqual(presentation.fullNames, ["Ana Técnica", "Carlos Contratista"]);
  assert.deepEqual(presentation.initials, ["AT", "CC"]);
  assert.equal(presentation.summary, "Ana Técnica · Carlos Contratista");
  assert.equal(presentation.accessibleLabel, "Técnicos: Ana Técnica · Carlos Contratista");
  assert.equal(presentation.visualVariant, "mixed");
  assert.deepEqual(
    presentation.entries.map(({ name, initials, responsibleType, typeLabel }) => ({
      name,
      initials,
      responsibleType,
      typeLabel
    })),
    [
      { name: "Ana Técnica", initials: "AT", responsibleType: "payroll", typeLabel: RESPONSIBLE_TYPES.payroll },
      { name: "Carlos Contratista", initials: "CC", responsibleType: "contractor", typeLabel: RESPONSIBLE_TYPES.contractor }
    ]
  );
});

test("la presentación compone estado, tooltip, responsables y etiqueta accesible", () => {
  const activity = {
    status: "in_progress",
    serviceType: "preventive",
    responsibleIds: ["r1"],
    observations: "Cambio de filtro",
    history: [{ action: "rescheduled" }]
  };
  const presentation = buildActivityPresentation(activity, {
    clientName: "Cliente Uno",
    siteName: "Sede Centro",
    responsibles: [{ id: "r1", name: "Jhon Jairo", responsibleType: "payroll" }]
  });

  assert.equal(presentation.status.icon, "▶");
  assert.equal(presentation.observationsTooltip, "Observaciones: Cambio de filtro");
  assert.equal(presentation.responsibles.summary, "Jhon Jairo");
  assert.equal(
    presentation.accessibleLabel,
    "Cliente Uno, sede: Sede Centro, técnicos: Jhon Jairo, tipo de servicio: Mantenimiento preventivo, estado: En ejecución, reprogramada, observaciones: Cambio de filtro"
  );
});
