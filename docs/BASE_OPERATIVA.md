# Guía de Base Operativa

La aplicación consulta `Base_operativa_HVAC_SIYS.xlsx` en modo de sólo lectura.
El libro fuente nunca se guarda ni modifica desde el calendario.

Para preparar un libro nuevo, use **Gestionar > Descargar plantilla de Base
Operativa**. El archivo `plantilla_base_operativa_HVAC_SIYS.xlsx` contiene los
encabezados aceptados y una hoja `Instrucciones`; no contiene datos reales.

## Hojas

| Hoja | Uso | Estado |
| --- | --- | --- |
| `dm_ciudad` | Ciudad y zona | Obligatoria |
| `dm_clientes` | Clientes | Obligatoria |
| `dm_sede` | Sedes, ciudad, dirección, ingreso y requisito de App | Obligatoria |
| `dm_directorio_siys` | Nómina y contratistas, ciudad base y cobertura | Obligatoria |
| `dm_equipo_cronograma` | Pistas de sede, grupos, frecuencia y meses | Opcional |

`dm_directorio_clientes`, cotizaciones y otras hojas no se cargan en el
calendario.

## Campos admitidos

- Ciudades: identificador, nombre, zona.
- Clientes: identificador, nombre.
- Sedes: identificador, cliente, nombre, ciudad, zona, centro comercial,
  dirección, condiciones de ingreso y requisito de App.
- Responsables: nombre, empresa, clasificación nómina/contratista, ciudad base,
  grupo, alturas y cursos.
- Equipos: identificador de subsidiaria, nombre de subsidiaria, grupo
  responsable, frecuencia y meses programados, únicamente como pistas
  agregadas.

La importación normaliza mayúsculas, tildes y espacios para conciliar claves,
pero conserva los nombres mostrados. Las asociaciones ambiguas quedan como
advertencia; no se asignan personas automáticamente.

## Privacidad

No se importan cédulas, NIT, teléfonos, correos, contactos, fotografías,
archivos, usuarios internos ni observaciones privadas del directorio. Los
respaldos se vuelven a sanear antes de descargarse.

## Carga masiva y mantenimiento

1. Mantenga identificadores estables y nombres únicos por cliente/sede.
2. Clasifique cada responsable como nómina o contratista.
3. Evite sedes duplicadas que sólo cambien por tildes o espacios.
4. Guarde el libro y cierre cambios pendientes antes de importarlo.
5. Revise la vista previa. Los ausentes no se eliminan y las activaciones,
   favoritos, colores o alias locales se conservan.
6. Para actualizar, importe nuevamente el libro completo.

Una hoja ausente, vacía o sin encabezados requeridos bloquea o limita la
importación según su obligatoriedad. Un encabezado incompleto se reporta en la
vista previa; debe corregirse en la fuente, no dentro del calendario.

## Encabezados de la plantilla

La plantilla conserva estos encabezados, que deben permanecer sin cambios:

| Hoja | Encabezados principales |
| --- | --- |
| `dm_ciudad` | `id`, `Zona`, `Ciudad` |
| `dm_clientes` | `id`, `Nombre` |
| `dm_sede` | `id`, `Cliente`, `Zona`, `Ciudad`, `Centro comercial`, `Nombre`, `Dirección`, `Ingresos`, `Requiere App` |
| `dm_directorio_siys` | `Nombre`, `Empresa`, `Tipo`, `Ciudad base`, `Grupo`, `Alturas`, `Cursos` |
| `dm_equipo_cronograma` | `_id`, `subsidiary._id`, `subsidiary.name`, `responsable ejecucion`, `Frecuencia` y meses |
