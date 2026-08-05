# Manual de uso — SIYS Sync

## 1. Abrir y reconocer el cronograma

Abra `dist/calendario-hvac-siys.html` en Chrome o Microsoft Edge. La aplicación
funciona sin servidor y sin conexión. En **Configuración > Nombre del cronograma** registre el nombre
del cronograma y el coordinador; estos datos aparecerán en los respaldos y en
las imágenes exportadas.

La revisión aumenta con los cambios operativos. Cambiar de mes, buscar o filtrar
no cambia la revisión.

## 2. Cargar la base operativa

1. Abra **Gestionar > Actualizar base operativa**.
2. Seleccione `Base_operativa_HVAC_SIYS.xlsx`.
3. Revise nuevos, actualizados, ausentes y advertencias.
4. Confirme la importación.

La aplicación sólo lee campos permitidos de clientes, sedes, ciudades,
responsables y pistas de cobertura. No modifica el Excel, no borra registros
locales ausentes y excluye documentos, teléfonos, correos y otros datos
personales. Consulte [BASE_OPERATIVA.md](BASE_OPERATIVA.md) para el esquema.

## 3. Crear y administrar actividades

Arrastre un cliente o sede a una fecha, haga clic en el fondo del día o pulse
**Nueva actividad**. La tarjeta contiene fecha, cliente, sede, ciudad, uno o
varios responsables, tipo de servicio, estado y observaciones.

Los servicios disponibles son mantenimiento preventivo, mantenimiento
correctivo, llamada de emergencia, diagnóstico, garantía y administrativo. En la
vista previa, la segunda línea de cada tarjeta inicia con un código corto: `MP`
(mantenimiento preventivo), `MC` (mantenimiento correctivo), `EM` (emergencia),
`DG` (diagnóstico), `GA` (garantía) o `AD` (administrativo). El nombre completo
se conserva en el detalle y en la información accesible de la tarjeta. Los estados son:
Programada, Confirmada, En ejecución, Terminada, No ejecutada,
Cancelada y Por programar. Una actividad confirmada exige al menos un
responsable.

### Bandeja Pendiente

La tercera pestaña del banco es **Pendiente** y reúne actividades por programar.
Use **Nuevo pendiente** para crear una tarjeta sin fecha o, desde el detalle de
una actividad Programada o Confirmada, pulse **Enviar a Pendiente**. También
puede arrastrar una tarjeta del calendario hasta la zona donde aparecen las
tarjetas Pendiente. Las actividades En
ejecución, Terminadas, No ejecutadas y Canceladas no pueden enviarse allí.

En una actividad multifecha puede enviar sólo ese día (la tarjeta queda
independiente) o **Toda la actividad**. Esta última opción conserva una tarjeta
representante, elimina las demás fechas y requiere confirmación; ambas
operaciones se pueden **Deshacer**. Una tarjeta Pendiente siempre tiene
`date: null`, no conserva `seriesId` y muestra el estado Por programar.

Para devolverla al calendario, use **Asignar fecha** o arrástrela a un día.
Domingos y festivos requieren una confirmación adicional. Al asignar fecha la
tarjeta vuelve automáticamente a Programada y queda como actividad de una sola
fecha.
Una actividad confirmada exige al menos un responsable.

Un rango genera tarjetas independientes enlazadas. Los domingos y festivos
colombianos se omiten inicialmente; la vista previa permite incluirlos. Cada
tarjeta se puede mover o editar después sin alterar las demás. El estado puede
aplicarse al día, desde ese día en adelante o a toda la actividad.

Las tarjetas terminadas se muestran opacas. Nómina, contratistas y equipos
mixtos tienen estilos distintos.

## 4. Selección y edición múltiple

Marque las casillas de las tarjetas o use `Ctrl`/`Cmd` al hacer clic.

- **Mover:** conserva las distancias relativas o reúne todo en una fecha.
- **Cambiar estado:** modifica sólo las tarjetas seleccionadas.
- **Editar campo:** cambia servicio, estado, responsables, ciudad u
  observaciones. Los responsables se pueden reemplazar, agregar o quitar; las
  observaciones se pueden reemplazar, anexar o vaciar.
- **Eliminar:** exige confirmación y permite deshacer una vez.

Cada operación es atómica: si una tarjeta quedaría inválida, no cambia ninguna.

### Mover, duplicar o ampliar al arrastrar

Al soltar una tarjeta en otra fecha, SIYS Sync pregunta qué operación realizar:

- **Mover:** conserva la misma tarjeta y cambia su fecha.
- **Duplicar:** crea una copia independiente con estado Programada.
- **Ampliar:** crea otro día de la misma actividad. Cada día conserva un ID
  propio y puede moverse por separado, pero queda vinculado a los demás.
- **Cancelar:** no realiza cambios.

Al editar una actividad ampliada se puede aplicar cliente, sede, ciudad,
responsables, servicio y observaciones sólo al día o a toda la actividad. La
fecha siempre pertenece a una tarjeta concreta y el estado conserva su alcance
independiente. Ampliar sólo está disponible al arrastrar una tarjeta. Soltarla
en su fecha actual no abre el diálogo ni genera historial.

## 5. Filtros y exportaciones

La búsqueda libre revisa cliente, sede, ciudad, servicio, estado, bandeja,
observaciones y responsables. **Filtros** permite seleccionar varias ciudades,
clientes, sedes, responsables, servicios, estados y bandejas. Dentro de una categoría se
acepta cualquiera de los valores; entre categorías deben cumplirse todos.

Los chips muestran los filtros activos y permiten retirarlos individualmente.
Las opciones sin resultados bajo los demás filtros quedan deshabilitadas.

- **CSV:** exporta las actividades del mes y separa nómina de contratistas.
- **CSV de pendientes:** descarga por separado las actividades sin fecha para
  revisarlas en Excel; el listado mensual nunca incluye estas tarjetas.
- **PNG:** crea una imagen horizontal a escala 2 con nombre, coordinador, mes,
  filtros, festivos y todas las tarjetas visibles, incluso en días densos.
- **Descargar copia del cronograma:** crea la copia portable completa
  (internamente es un archivo JSON).

## 6. Importar programación con plantilla

1. Pulse **Descargar plantilla de programación** y abra
   `plantilla_programacion_SIYS-Sync.xlsx`.
2. Conserve las hojas `Programacion`, `Catalogos` e `Instrucciones`.
3. Reemplace la fila de ejemplo y guarde el archivo.
4. Pulse **Cargar programación desde Excel** y revise la vista previa.
5. Corrija las filas con error. Las filas válidas se pueden importar en una
   sola operación con opción de deshacer.

Columnas de `Programacion`:

| Columna | Regla |
| --- | --- |
| `FechaInicio` | Obligatoria, fecha inicial |
| `FechaFin` | Opcional; vacía equivale a un día |
| `Bandeja` | Opcional para compatibilidad; `Calendario` o `Pendiente` |
| `Cliente` | Coincidencia exacta; opcional sólo en Administrativo |
| `Sede` | Coincidencia exacta dentro del cliente; opcional sólo en Administrativo |
| `Ciudad` | Obligatoria para servicios operativos; se completa desde la sede si está vacía |
| `Responsables` | Nombres exactos separados por `;` |
| `TipoServicio` | Uno de los seis tipos admitidos |
| `Estado` | Uno de los siete estados admitidos |
| `Observaciones` | Texto opcional |
| `IncluirNoLaborables` | `Sí` o `No` |

Si `Bandeja` se omite, la fila se interpreta como Calendario. Una fila
Pendiente debe venir sin FechaInicio ni FechaFin y con estado Por programar;
una fila Calendario debe tener fecha y no puede usar Por programar.

La importación no crea clientes, sedes ni responsables faltantes. Reporta
ambigüedades, duplicados y fechas no laborables omitidas. Los duplicados se
omiten por defecto y se pueden incluir expresamente.

## 7. Persistencia, pestañas y copias de seguridad

El archivo local usa IndexedDB dentro del perfil del navegador y del origen.
Las publicaciones de GitHub Pages guardan el documento autenticado en
Supabase:

- el archivo local, estable y beta tienen almacenamientos separados;
- Chrome y Edge no comparten datos;
- dos perfiles del mismo navegador no comparten datos;
- copiar la carpeta HTML no copia la programación local;
- stable usa `calendario-hvac-siys` y beta usa `calendario-hvac-siys-beta` dentro
  del mismo proyecto Supabase.

**Proteger almacenamiento** solicita persistencia al navegador. La concesión
reduce la posibilidad de liberación automática, pero no garantiza una copia de
seguridad. Use **Descargar copia del cronograma** regularmente y guárdela fuera
de la carpeta temporal.

Sólo una pestaña edita. Las demás quedan en lectura y pueden filtrar, imprimir
y exportar. **Tomar control** transfiere la edición. Si la pestaña editora se
cierra o falla, otra recupera el control tras unos 15 segundos.

Al restaurar se muestran cronograma, coordinador, revisión y antigüedad. La
restauración reemplaza el documento, no mezcla versiones, y conserva una copia
de recuperación local. Se aceptan respaldos heredados de `v0.1.0`.

### Añadir sin reemplazar

**Gestionar > Combinar otra copia** prepara una combinación y muestra nuevos,
actualizados, registros idénticos y conflictos antes de guardar. La operación:

- conserva el nombre, coordinador, filtros y mes del cronograma actual;
- remapea clientes, sedes, responsables y series equivalentes;
- nunca elimina registros porque no aparezcan en el archivo;
- usa `updatedAt`: gana el más reciente y en empate se conserva el actual;
- se guarda como una sola revisión y permite Deshacer.

El respaldo identifica su canal `local`, `stable` o `beta`. Si se añade en otro
canal, SIYS Sync muestra una advertencia, pero el archivo sigue siendo portable.

### Estable y beta

La raíz de GitHub Pages contiene la estable `v0.14.1` y `/beta/` contiene la
línea beta correspondiente; ambos usan Supabase Auth y la base cloud
compartida, con calendarios lógicos independientes. La versión visible y el
`channel` del respaldo deben comprobarse antes de trasladar datos. Los datos
locales no se copian automáticamente a Supabase: deben exportarse como JSON y
recuperarse dentro del canal autorizado.

Al actualizar la stable por primera vez, SIYS Sync puede trasladar
automáticamente su documento IndexedDB anterior si el calendario Supabase está
vacío. Conserva la copia local, no reemplaza un calendario cloud que ya tenga
datos y no repite la migración después de **Borrar y empezar de cero**.

### Reiniciar el navegador

En **Gestionar > Borrar y empezar de cero**, escriba `REINICIAR`. SIYS Sync
descarga una copia y después elimina el documento activo y su recuperación en ese
origen. La opción adicional restablece preferencias visuales como el estado del
banco. Las demás pestañas reciben una notificación y recargan el documento
vacío para no reintroducir información anterior.

## 8. Apariencia

En **Configuración > Tema** puede cambiar directamente entre **Sistema**,
**Claro** y **Oscuro** con cada clic; la preferencia se conserva por canal.
La primera apertura usa Sistema. Después se recuerda la elección. Sistema sigue
la preferencia de Chrome, Edge o Windows y reacciona si esta
cambia mientras la aplicación está abierta. La elección se guarda únicamente
como preferencia visual del canal actual: no aumenta la revisión, no entra en
respaldos JSON y no se mezcla entre local, estable y beta.

La exportación PNG respeta el tema que esté activo. La impresión siempre usa
una presentación clara para conservar legibilidad y ahorrar tinta, aunque la
interfaz esté en modo oscuro.

## 9. Teléfonos y tabletas

En pantallas de hasta 899 px de ancho, SIYS Sync usa una agenda diaria como
vista principal. Use **Anterior**, **Hoy** y **Siguiente** para cambiar de fecha
y **Nueva actividad** para crear en el día mostrado. **Ver mes** abre un
selector mensual superpuesto; tocar una fecha cierra el selector y muestra su
agenda sin abrir el formulario. **Más** agrupa Banco, Gestionar, Compartir y
Configuración.

El Banco abre el catálogo como panel lateral. Como alternativas táctiles, las
tarjetas de la agenda abren el detalle, donde están **Editar tarjeta**,
**Mover · Duplicar · Ampliar**,
**Actualizar estado** y **Eliminar**. Al organizar una actividad se elige la
fecha y luego una acción independiente: no es necesario arrastrar. Mover y
Ampliar se deshabilitan si se elige el mismo día; Duplicar sigue disponible.

En tablet horizontal y escritorio se conserva el tablero completo de siete
columnas. En pantallas bajas, el calendario y la agenda tienen desplazamiento
propio. La exportación CSV, PNG, JSON y la impresión no cambian por el tamaño
de pantalla.

## 10. Solución de problemas

Los nombres descargados permiten reconocer el contenido sin conocer su formato:

- `YYYY-MM-DD_HH-mm-ss_respaldo-cronograma_<nombre>.json`;
- `YYYY-MM_programacion_<nombre>.csv`;
- `YYYY-MM_cronograma_<nombre>.png`;
- `plantilla_programacion_SIYS-Sync.xlsx`.

- **No guarda:** descargue JSON inmediatamente, compruebe que IndexedDB esté
  habilitado y que el navegador tenga espacio.
- **Sólo lectura:** cierre la pestaña editora o use **Tomar control** después de
  confirmar que nadie esté ingresando datos.
- **Cliente o responsable no aparece:** reimporte la Base Operativa o actívelo
  desde el catálogo.
- **Excel rechazado:** descargue una plantilla nueva y no cambie encabezados ni
  nombres de hojas.
- **PNG sin una tarjeta esperada:** revise chips y búsqueda; la imagen respeta
  la vista filtrada.
- **Cambio de equipo o navegador:** exporte JSON en el origen anterior y
  restáurelo en el nuevo.
