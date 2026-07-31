# Guía de Base Operativa

La aplicación consulta `Base_operativa_HVAC_SIYS.xlsx` en modo de sólo lectura.
El libro fuente nunca se guarda ni modifica desde el calendario.

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

