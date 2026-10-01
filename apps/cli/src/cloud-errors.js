export class CloudCliError extends Error {
  constructor(code, message, { status = 0, details = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "CloudCliError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function cloudError(code, message, options = {}) {
  return new CloudCliError(code, message, options);
}
