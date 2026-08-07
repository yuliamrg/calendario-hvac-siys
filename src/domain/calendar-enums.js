export const SERVICE_TYPES = Object.freeze({
  preventive: "Mantenimiento preventivo",
  corrective: "Mantenimiento correctivo",
  emergency: "Llamada de emergencia",
  diagnostic: "Diagnóstico",
  warranty: "Garantía",
  administrative: "Administrativo"
});

export const ACTIVITY_STATUSES = Object.freeze({
  scheduled: "Programada",
  confirmed: "Confirmada",
  in_progress: "En ejecución",
  completed: "Terminada",
  not_executed: "No ejecutada",
  cancelled: "Cancelada",
  to_schedule: "Por programar"
});

export const PLANNING_BUCKETS = Object.freeze({
  calendar: "Calendario",
  quarantine: "Pendiente"
});

export const QUARANTINE_ALLOWED_STATUSES = Object.freeze([
  "scheduled",
  "confirmed"
]);

export const RESPONSIBLE_TYPES = Object.freeze({
  payroll: "Personal de nómina",
  contractor: "Contratista"
});

export const STATUS_SCOPES = Object.freeze({
  single: "Solo este día",
  future: "Este día y siguientes",
  series: "Toda la actividad"
});
