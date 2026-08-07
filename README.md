# SIYS Sync

Herramienta para programar servicios HVAC en un calendario mensual. El
entregable listo para usar es:

`dist/calendario-hvac-siys.html`

El archivo abierto con doble clic conserva un modo local sin instalación y
guarda la información mediante IndexedDB. La publicación HTTP construida con
las variables de Supabase usa Auth, PostgREST y la base compartida del proyecto
cloud; el frontend sigue siendo un artefacto estático que puede servirse desde
GitHub Pages o desde el VPS.

El HTML servido en `localhost`, `127.0.0.1` o `::1` también se identifica como
canal local: conserva IndexedDB y hereda la interfaz visual aprobada de la beta.
Sólo las rutas pública estable y beta activan Supabase.

El repositorio también incluye la CLI local `calendary` para inspeccionar y
modificar copias JSON sin acceder directamente a IndexedDB. Consulte la
[guía de la CLI](docs/CLI.md), el [contrato compartido](docs/CONTRATO_CALENDARIO.md)
y el [runbook de respaldos](docs/OPERACION_RESPALDOS_JSON.md).

También puede abrirse desde GitHub Pages. En esta rama, Pages se construye con
Supabase y los datos dejan de depender del navegador. El archivo local sigue
usando IndexedDB para conservar una ruta offline y de recuperación; la opción
**Descargar copia del cronograma** permite trasladar una programación local al
entorno cloud mediante **Recuperar una copia**.

GitHub Pages ofrece dos canales:

- estable: `https://yuliamrg.github.io/calendario-hvac-siys/`;
- beta: `https://yuliamrg.github.io/calendario-hvac-siys/beta/`.

Stable y beta usan la base administrada de Supabase con calendarios lógicos
separados: `calendario-hvac-siys` para la raíz estable y
`calendario-hvac-siys-beta` para `/beta/`. Probar la beta no reemplaza el
cronograma operativo. En la primera apertura de stable, los datos heredados de
su IndexedDB se trasladan una sola vez si el calendario cloud está vacío; la
copia local se conserva y un cloud con datos nunca se sobrescribe.

## Primer uso

1. Abra `dist/calendario-hvac-siys.html`.
2. Abra **Gestionar > Actualizar base operativa** y seleccione
   `Base_operativa_HVAC_SIYS.xlsx`.
3. Revise la vista previa y confirme la importación.
4. Arrastre una sede desde el banco a un día o haga clic en el fondo del día.
5. Complete la tarjeta y guárdela.
6. Use **Descargar copia del cronograma** al terminar una carga importante.

La importación sólo lee clientes, sedes, ciudades, responsables y pistas
operativas permitidas. No elimina registros locales, no reemplaza campos
personalizados y no importa cédulas, NIT, correos ni contactos.

## Operación

- El calendario empieza en lunes y muestra domingos y festivos colombianos.
- Una tarjeta admite varios responsables, separados entre nómina y
  contratistas.
- Los tipos incluyen Preventivo, Correctivo, Emergencia, Diagnóstico, Garantía
  y Administrativo; los estados incluyen Programada, Confirmada, En ejecución,
  Terminada, No ejecutada, Cancelada y Por programar.
- La pestaña **Pendiente** funciona como bandeja de actividades sin fecha.
  Son actividades por programar: permite crear, enviar o arrastrar una tarjeta
  desde el calendario, asignar fecha o arrastrarla al calendario; una
  actividad multifecha puede independizarse por día o convertirse completa con
  confirmación y Deshacer.
- Puede seleccionar varias tarjetas con su casilla o con `Ctrl`/`Cmd`, moverlas
  juntas o cambiarles el estado.
- Un día muestra hasta tres tarjetas. Si hay más, aparece una pila visual con
  miniaturas de las tarjetas adicionales, códigos de servicio y estados; al
  pulsarla se abre la agenda completa del día. Las tarjetas del mismo día se
  pueden reordenar arrastrando desde el calendario o desde la agenda del día,
  o con los controles Primera, Anterior, Siguiente y Última; el orden se conserva
  al recargar.
- Con teclado, entre al calendario con `Tab` y recorra las fechas con las
  flechas; `Enter` abre una nueva actividad en la fecha enfocada.
- Un servicio de varios días crea tarjetas independientes vinculadas. Después
  puede editar una fecha, las fechas futuras o toda la serie.
- Al arrastrar una tarjeta a otro día puede **Mover**, **Duplicar** o
  **Ampliar**. Ampliar conserva tarjetas diarias independientes, pero enlaza
  sus datos comunes. Soltar en otra tarjeta del mismo día permite reordenarla.
- **Compartir** permite descargar el CSV de pendientes, una imagen de pendientes
  y una imagen del calendario con la información de las tarjetas y su leyenda.
- En teléfono y tablet vertical, la agenda diaria es la vista principal.
  **Ver mes** abre un selector superpuesto y **Más** agrupa Banco, Gestionar,
  Compartir y Configuración. El detalle ofrece alternativas táctiles para Mover, Duplicar,
  Ampliar, Editar y Cambiar estado sin depender del arrastre.
- En tablet horizontal y escritorio se conserva el tablero completo; los temas
  Claro, Oscuro y Sistema funcionan en todos los tamaños.
- El banco se puede ocultar y tiene desplazamiento propio.
- Domingos y festivos se excluyen inicialmente de los rangos; la vista previa
  permite incluir fechas específicas.
- Los cierres manuales y las excepciones laborales se administran con el botón
  **Festivos y ajustes** (símbolo `◉`).
- **Compartir > Descargar listado del mes** genera la programación del mes visible con columnas
  separadas para personal de nómina y contratistas.
- **Compartir > Descargar listado de pendientes** genera un CSV independiente
  compatible con Excel; las actividades sin fecha no entran en el listado mensual.
- **Filtros** combina varias ciudades, clientes, sedes, responsables, servicios
  y estados; **PNG** descarga exactamente esa vista.
- **Plantilla** e **Importar programación** permiten una carga masiva Excel con
  validación previa, columna opcional `Bandeja`, detección de duplicados y una
  sola operación deshacible.

## Persistencia cloud y copias de seguridad

El proyecto Supabase de esta rama es `calendario-hvac-siys-dev`
(`toxeasjfwxbniuuwfimz`). La migración se aplica con:

```powershell
npx supabase link --project-ref toxeasjfwxbniuuwfimz
npx supabase db push --linked
```

La aplicación publicada pide una cuenta de Supabase y guarda el documento JSON
en `public.calendar_documents`, protegido por RLS y asociado a un calendario y
a su membresía. Sólo se debe incluir en el frontend la URL y la clave
`publishable`; nunca la `service_role` ni la contraseña de Postgres. El archivo
local continúa usando IndexedDB y no necesita autenticación.

El workflow de Pages necesita las variables de repositorio
`SIYS_SUPABASE_URL` y `SIYS_SUPABASE_PUBLISHABLE_KEY`. La URL de Auth ya permite
los canales estable y BETA de GitHub Pages. Si el VPS usa otro dominio, debe
añadirse como redirect URL en la configuración de Auth antes de publicar allí.

El primer acceso cloud crea el calendario para la cuenta autenticada. Para
abrirlo desde otro equipo, inicia sesión con la misma cuenta; el acceso de
otras cuentas se puede añadir después mediante membresías de Supabase. En el
mismo origen, la sesión se reutiliza entre stable y beta, pero los calendarios
lógicos siguen separados.

## Persistencia local y copias de seguridad

El archivo local permanece únicamente en el navegador y equipo donde se usó.
Borrar los datos del navegador, cambiar de perfil o usar otro equipo no traslada
la programación local. El modo cloud no sustituye las copias JSON: permiten
recuperar una base local, revisar cambios y migrar datos entre entornos.

Use **Gestionar > Descargar copia del cronograma** regularmente y guárdela en
una carpeta sincronizada o protegida. La copia incluye el nombre del cronograma,
coordinador, revisión, versión y origen de exportación. **Recuperar una copia**
valida el archivo, advierte si su revisión es anterior o igual y conserva una
copia de recuperación local. Los respaldos creados con `v0.1.0` se migran
automáticamente.

Para trasladar un respaldo entre la interfaz y una CLI, use siempre el
procedimiento de [Operación de respaldos JSON](docs/OPERACION_RESPALDOS_JSON.md).
En este equipo la carpeta canónica es
`C:\Users\CoordServicio\OneDrive - Siys\cronogramas\Respaldo`. El respaldo
original no se sobrescribe: se descarga uno nuevo, se genera un archivo
modificado con nombre distinto y se verifica un respaldo final en el mismo
canal y perfil del navegador.

**Borrar y empezar de cero** descarga primero una copia y exige escribir
`REINICIAR`. La operación limpia el cronograma y su recuperación en ese
navegador, sin afectar otros perfiles u orígenes.

**Recuperar una copia del cronograma** reemplaza el documento completo.
**Combinar otra copia** combina catálogos, actividades, series y excepciones sin eliminar
registros ausentes. El registro con `updatedAt` más reciente gana; en empate se
conserva el actual y la vista previa informa el conflicto.

La sección **Datos locales del navegador** indica si el navegador concedió
persistencia al origen. Esta protección reduce el riesgo de liberación
automática por falta de espacio, pero no reemplaza los respaldos JSON.

Sólo una pestaña puede editar a la vez. Las demás abren en modo de lectura y
pueden consultar, filtrar y exportar. **Tomar control** transfiere la edición a
la pestaña actual; si la pestaña editora se cierra o deja de responder, otra
recupera el control después de aproximadamente 15 segundos.

## Nombre del cronograma y edición múltiple

**Configuración > Nombre del cronograma** permite asignar un nombre y coordinador. La
revisión aumenta con cada cambio operativo; navegar entre meses o aplicar
filtros no la incrementa.

Al seleccionar varias tarjetas se puede:

- moverlas conservando la distancia relativa o reunirlas en una fecha;
- cambiar el estado;
- reemplazar el servicio;
- reemplazar, agregar o quitar responsables;
- reemplazar o vaciar la ciudad;
- reemplazar, agregar o vaciar observaciones;
- eliminarlas con confirmación.

Las operaciones múltiples son atómicas: si alguna tarjeta quedaría inválida,
no cambia ninguna. La última operación se puede deshacer.

## Actualizar el catálogo

La Base Operativa se puede importar nuevamente cuando cambien clientes, sedes o
responsables. Antes de aplicar, la herramienta muestra los registros nuevos,
actualizados, sin cambios y ausentes. Los ausentes no se borran
automáticamente.

## Desarrollo y verificación

Requiere Node.js 20 o superior sólo para reconstruir el entregable:

```powershell
npm test
npm run build
npm run audit
npm run goal:check
```

La matriz y la ruta e2e de la CLI están documentadas en
[Pruebas CLI](docs/PRUEBAS_CLI.md).

El HTML incorpora localmente SheetJS Community Edition 0.20.3 para leer
archivos Excel. Su licencia y aviso se encuentran en `vendor/` y también están
incluidos dentro del HTML generado.

Documentación:

- [Manual completo](docs/MANUAL_DE_USO.md)
- [Guía de Base Operativa](docs/BASE_OPERATIVA.md)
- [Criterios de diseño y promoción beta](docs/CRITERIOS_DE_DISENO.md)
- [Reglas de versionamiento](docs/VERSIONAMIENTO.md)
- [Guía de la CLI](docs/CLI.md)
- [Contrato compartido](docs/CONTRATO_CALENDARIO.md)
- [Pruebas CLI](docs/PRUEBAS_CLI.md)
- [Operación de respaldos JSON](docs/OPERACION_RESPALDOS_JSON.md)
- [Historial de cambios](CHANGELOG.md)
- [Distribución y GitHub Pages](docs/DISTRIBUCION.md)
