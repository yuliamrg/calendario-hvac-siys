import assert from "node:assert/strict";
import test from "node:test";

test("la suite bloquea solicitudes HTTP externas antes de contactar Supabase", async () => {
  await assert.rejects(
    fetch("https://example.supabase.co/rest/v1/rpc/persist_calendar_document", {
      method: "POST",
      body: JSON.stringify({ target_calendar_id: "operational-fixture" })
    }),
    /guarda de pruebas bloqueó una solicitud HTTP externa/
  );
});
