# Exportación y limpieza mensual

Los endpoints requieren Bearer JWT de un usuario ADMIN. No ejecutan tareas programadas por sí solos.

## Configuración

Definir `RETENTION_BACKUP_DIR` como ruta absoluta de un volumen **persistente**, privado y compartido entre las réplicas de la API. No usar `/tmp`, un directorio público ni el filesystem efímero de funciones serverless. La API necesita permisos de escritura y lectura. Mantener una copia externa del volumen; el endpoint no gestiona la retención de respaldos.

El rol de `DATABASE_URL` debe poder leer todas las filas y borrar en las cuatro tablas. Se desactiva el filtrado silencioso por RLS para fallar si el rol no puede obtener una exportación completa. No se requieren credenciales PostgreSQL del usuario del navegador.

## Ejecución

`POST /maintenance/backups/{uuid-v4}/cleanup`

Generar un UUID nuevo por operación y guardarlo antes de enviar la petición. Sin cuerpo. La respuesta exitosa es el archivo XLSX como attachment. La operación:

En `/panel`, el botón **Exportar Base de datos** ejecuta el flujo y descarga `Media-pulse-MES.xlsx` (por ejemplo, `Media-pulse-SEPTIEMBRE.xlsx`). La UI conserva el último ID para consultar el estado y recuperar la descarga. El mes y el corte usan UTC, calculados por el servidor al comenzar la operación.

1. Bloquea escrituras en las cuatro tablas durante el proceso (las lecturas continúan).
2. Comprueba dependencias y obtiene todos los registros y columnas, sin filtros de fecha ni paginación.
3. Genera un Excel con cuatro hojas y todos los registros. Omite únicamente `impressions`, `clicks`, `conversions` y `revenue` de la hoja `daily_metrics`. El JSON conserva las filas originales completas serializadas por PostgreSQL, preservando precisión y nulos. En Excel los valores se guardan como texto para no perder decimales, microsegundos o identificadores.
4. Guarda y sincroniza ambos archivos y un manifiesto con hashes SHA-256, ID del administrador, conteos y corte. Verifica los bytes guardados antes del primer DELETE.
5. Borra en una transacción las filas con `created_at < corte` y guarda los conteos eliminados.
6. Devuelve el Excel al cliente. El borrado ocurre después de persistir el respaldo en el servidor, **antes de que el navegador termine de descargarlo**. HTTP no permite comprobar que el usuario guardó el archivo en su disco.

El corte es el día 1 de dos meses antes del mes actual, a las 00:00 UTC. Se conservan el mes actual y los dos anteriores. Octubre de 2026 conserva desde `2026-08-01T00:00:00Z`; enero de 2027 conserva desde `2026-11-01T00:00:00Z`. Son meses calendario, no una ventana móvil de días. Se conservan valores `created_at` nulos y fechas futuras. Se usa `created_at`, no `mes` ni la fecha de la métrica.

Tablas: `daily_metrics`, `manual_investment_deviation_comments`, `manual_investment_lines`, `manual_investment_logs`.

## Recuperación y estado

- `GET /maintenance/backups/{id}`: estado, corte, conteos de respaldo y borrado, hashes.
- `GET /maintenance/backups/{id}/download`: vuelve a descargar el mismo Excel sin ejecutar borrados.
- Un ID utilizado retorna 409 al intentar otro POST, incluso si la operación falló. Consultar su estado antes de crear otro ID.
- `unconfirmed` significa que hay un respaldo pero no se confirmó el resultado final. Puede ocurrir si el proceso se cae antes o después del COMMIT. No repetir automáticamente: verificar la base y el respaldo.
- Los archivos quedan en `<RETENTION_BACKUP_DIR>/<id>/`: `backup.xlsx`, `backup.json`, `prepared.json` y, al completar, `completed.json`. El JSON es un complemento fiel de datos; no incluye DDL, índices, permisos ni una restauración automática.

## Límites y protección

Falla sin borrar si el respaldo no puede guardarse/verificarse, si una tabla supera 100.000 filas, si una celda excede 32.767 caracteres o si no obtiene los locks en 5 segundos. Consultas limitadas a 120 segundos; configurar el timeout HTTP/proxy para el volumen esperado. La generación actual ocurre en memoria, adecuada para el volumen actual; cantidades mayores requieren streaming/job asíncrono.

Cancela toda la limpieza si una línea antigua tiene comentarios con fecha vigente o nula, porque su FK `ON DELETE CASCADE` los borraría. También rechaza otras relaciones entrantes o triggers DELETE habilitados hasta que sean revisados. No deshabilita restricciones.

El respaldo completo consume transferencia (Egress); borrar filas no revierte el consumo previo. La ingesta puede recrear datos históricos según su configuración.

## Ejemplo desde un cliente web autenticado

```javascript
const id = crypto.randomUUID(); // conservar este ID para consultar o reintentar la descarga
const response = await fetch(`${apiUrl}/maintenance/backups/${id}/cleanup`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
});
if (!response.ok) throw new Error(`Falló la operación ${id}: ${await response.text()}`);
const url = URL.createObjectURL(await response.blob());
const link = document.createElement('a');
link.href = url;
link.download = `backup-${id}.xlsx`;
link.click();
setTimeout(() => URL.revokeObjectURL(url), 60000);
```

Validación local: `npm --workspace @mediapulse/api run build` y `node --test apps/api/test/maintenance.test.cjs`. Las pruebas usan una conexión simulada, sin borrar registros reales.
