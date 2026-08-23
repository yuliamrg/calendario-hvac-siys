# Mapa de documentación

Esta carpeta reúne la documentación de SIYS Sync. Elige el documento según la
persona y la tarea; los planes de implementación se conservan como historial y
no sustituyen las fuentes del código actual.

## Para clientes y coordinación

- [Manual de uso](MANUAL_DE_USO.md): abrir la aplicación, cargar la Base
  Operativa, programar, filtrar, exportar y recuperar respaldos.
- [Guía de Base Operativa](BASE_OPERATIVA.md): hojas, columnas permitidas y
  exclusiones de privacidad.
- [Operación de respaldos JSON](OPERACION_RESPALDOS_JSON.md): procedimiento
  seguro para copiar, validar, restaurar o combinar cronogramas.

## Para operación técnica

- [Mapa del sistema](SISTEMA.md): canales, persistencia, actores, seguridad y
  límites local/cloud.
- [Modelo de estados](MODELO_ESTADOS.md): documento canónico, estados,
  transiciones y reglas del esquema 4.
- [Criterios de diseño](CRITERIOS_DE_DISENO.md): experiencia, accesibilidad,
  responsive y promoción beta/estable.
- [Distribución](DISTRIBUCION.md): canales y flujo de GitHub Pages.
- [Versionamiento](VERSIONAMIENTO.md): SemVer, commits de release, tags y
  compatibilidad.
- [Build y releases](BUILD_RELEASE.md): manifiesto, artefactos y gates.

## Para desarrollo e integración

- [Arquitectura](ARQUITECTURA.md): capas, módulos y fronteras de importación.
- [Contrato del calendario](CONTRATO_CALENDARIO.md): operaciones, payloads,
  respuestas y errores.
- [CLI](CLI.md): comandos locales y lecturas cloud.
- [Pruebas CLI](PRUEBAS_CLI.md): smoke, e2e y cobertura del contrato.
- [Historial de cambios](../CHANGELOG.md): cambios agrupados por versión
  publicada.

## Fuentes de autoridad

Cuando exista una diferencia, se debe comprobar en este orden:

1. código y pruebas para el comportamiento;
2. `package.json`, `src/core.js`, `stable-version.txt` y `scripts/build.mjs`
   para versión, canales y empaquetado;
3. esta documentación para explicar el uso y las decisiones;
4. planes y reportes históricos sólo como contexto.

La documentación local no demuestra por sí sola que GitHub Pages, Supabase o
las migraciones remotas estén desplegados. Esa verificación requiere el gate y
la evidencia operativa correspondientes.
