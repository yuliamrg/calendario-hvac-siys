// Fachada pública estable para la interfaz y consumidores del paquete.
export {
  applyParsedImport,
  buildImportPreview,
  parseBaseWorkbook
} from "./import/base-operativa.js";
export {
  PROGRAMMING_COLUMNS,
  applyProgrammingImport,
  parseProgrammingWorkbook
} from "./import/programming.js";
