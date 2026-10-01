import { CloudCliError } from "./cloud-errors.js";

export async function readPassword(stdin, stderr, prompt = "Contraseña Supabase: ") {
  if (!stdin?.isTTY || typeof stdin.setRawMode !== "function") {
    throw new CloudCliError("AUTH_INTERACTIVE_REQUIRED", "cloud login requiere una terminal o --password-stdin; nunca pases la contraseña por argv.");
  }
  stderr.write(prompt);
  return new Promise((resolve, reject) => {
    let value = "";
    const wasRaw = stdin.isRaw;
    const cleanup = () => {
      stdin.off("data", onData);
      try { stdin.setRawMode(Boolean(wasRaw)); } catch { /* terminal may already be closed */ }
      stdin.pause();
      stderr.write("\n");
    };
    const onData = (chunk) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      for (const character of text) {
        if (character === "\u0003") {
          cleanup();
          reject(new CloudCliError("CANCELLED", "Inicio de sesión cancelado."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u007f") value = value.slice(0, -1);
        else value += character;
      }
    };
    try {
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on("data", onData);
    } catch (error) {
      cleanup();
      reject(new CloudCliError("AUTH_INTERACTIVE_REQUIRED", "No se pudo leer la contraseña de forma segura.", { cause: error }));
    }
  });
}

export async function readPasswordFromStdin(stdin) {
  let value = "";
  for await (const chunk of stdin) value += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  return value.replace(/[\r\n]+$/, "");
}
