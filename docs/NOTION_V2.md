# MediaPulse RHD — Cambios de la versión 2.0.0

Fecha de revisión: 7 de septiembre de 2026. Documento en Markdown, preparado para importar en Notion.

## 1. Alcance y origen

Esta documentación cubre los cambios incorporados a V2 y el ajuste final de exportación y retención. Complementa la documentación V1 existente.

| Referencia Git | Alcance |
| --- | --- |
| `6fe9a6b` | Estado anterior usado como base; su funcionalidad queda fuera de esta entrega |
| `b9b3889` — `mediapulse 2v` | Panel administrativo, usuarios, permisos, anunciantes, cuentas API, navegación y ajustes operativos |
| `f9c193c` — `update export bd` | Respaldo, descarga Excel, limpieza transaccional y regla final de tres meses calendario |

La revisión se hizo con `git diff 6fe9a6b..f9c193c`, leyendo los controladores, servicios, repositorios, componentes, migraciones y configuración afectados. Al comenzar la revisión no había cambios pendientes: ambos bloques ya estaban confirmados. Los cambios previos a `6fe9a6b`, incluidos PDF y loaders anteriores, no se vuelven a documentar aquí.

Los manifiestos de la raíz, API y web pasan de `1.1.2` a `2.0.0`.

## 2. Resumen funcional

| Área | Incorporación de V2 |
| --- | --- |
| Administración | Nueva pantalla `/panel`, exclusiva para administradores |
| Usuarios | Listado, alta, edición y baja lógica; protección del último administrador |
| Anunciantes y marcas | Alta/reutilización de relaciones, visualización de cuentas y suspensión/reactivación |
| Plataformas | Carga de Account IDs en PostgreSQL, individual o por lote |
| Integraciones | Lectura de cuentas habilitadas desde la base y compatibilidad con IDs anteriores del entorno |
| Navegación | Barra lateral compartida y menú móvil con acceso según rol |
| Control | Tabla más compacta, títulos emergentes y eliminación de un fallback de coincidencia aproximada de Meta |
| Respaldo | Exportación Excel de todos los registros de cuatro tablas y descarga recuperable |
| Limpieza | Conservación del mes actual y los dos anteriores, según `created_at` en UTC |
| API | Guards de autenticación/roles, nuevos endpoints y agrupación Swagger |

## 3. Panel administrativo y navegación

La ruta real es `/panel`, en minúsculas. La pantalla valida la sesión mediante `/auth/me` antes de mostrar la administración. Sin sesión redirige a login; un usuario autenticado que no sea ADMIN vuelve a Control. Incluye estados de carga, errores y reintentos.

El panel reúne:

- Gestión de usuarios: tabla, búsqueda, selección, alta, edición y confirmación de baja.
- Anunciantes y marcas: relaciones existentes, formulario de guardado y confirmación de suspensión/reactivación.
- Plataformas: selección de Meta, Google, TikTok o Mercado Libre y carga de múltiples Account IDs.
- Respaldo de datos: exportación, limpieza y recuperación de la última descarga.

Se incorpora `AppSidebar` como estructura compartida con Control, Forecast y Credit Alloc. Sustituye la navegación superior de pestañas y ubica la identidad, rol y cierre de sesión en la barra lateral.

| Opción del menú | Ruta | Visibilidad en la barra lateral |
| --- | --- | --- |
| Control | `/control` | Usuarios autenticados |
| Forecast | `/carga-manual` | Usuarios autenticados |
| Credit Alloc | `/CreditAlloc` | ADMIN |
| Panel | `/panel` | ADMIN |

En móvil hay apertura/cierre del menú, bloqueo del desplazamiento del fondo, gestión del foco, cierre con Escape y navegación con Tab dentro del menú abierto. Los estilos del panel se adaptan a pantallas pequeñas.

## 4. Usuarios, autenticación y permisos

### Administración de usuarios

Se separa `UsersController` del controlador de login. Todas las rutas `/auth/users` exigen JWT y rol ADMIN.

- El listado devuelve usuarios activos, ordenados por nombre, email e ID, sin contraseñas ni hashes.
- El alta conserva generación de UUID en PostgreSQL y normaliza nombre/email.
- La edición admite cambios parciales de nombre, email, contraseña y rol. Rechaza un cuerpo sin campos editables y nombres vacíos.
- El cambio de contraseña requiere al menos seis caracteres en el DTO.
- La baja es lógica: actualiza `deleted_at` y `updated_at`.
- No se permite eliminar ni degradar al último ADMIN activo. Además de la validación del servicio, el repositorio comprueba esta condición dentro de una transacción con bloqueo para evitar carreras.
- El email es único entre usuarios activos. Un email de un usuario dado de baja puede reutilizarse.
- La UI actualiza la sesión local cuando el administrador edita su propio usuario y ajusta la navegación si pierde el rol administrativo.

### Autenticación

Se reemplaza el uso directo de `jsonwebtoken` por `@nestjs/jwt`. El módulo configura firma y verificación con HS256 y mantiene `JWT_EXPIRES_IN` como vencimiento configurable.

`JwtAuthGuard` obtiene el usuario activo desde la base; `RolesGuard` verifica el rol requerido con `@Roles(...)`. `/auth/me` utiliza el guard y devuelve la identidad validada.

`JWT_SECRET` es obligatorio en producción. Los valores de ejemplo con prefijo `replace_` también se consideran placeholders. La clave por defecto queda limitada al entorno no productivo.

`GET /investments` y `GET /investments/manual` pasan a requerir autenticación y propagan el usuario al servicio para aplicar la visibilidad de anunciantes suspendidos.

La creación HTTP de usuarios no ofrece un alta anónima del primer administrador. Una instalación nueva requiere aprovisionar ese primer ADMIN por una operación controlada.

## 5. Anunciantes, marcas y suspensión

`brand_mappings` incorpora `enabled` y `suspended_at`. El listado administrativo incluye relaciones y cuentas asociadas. Los listados generales de clientes y marcas filtran relaciones deshabilitadas.

El guardado de anunciante/marca:

1. Exige ambos nombres y elimina espacios de los extremos.
2. Busca una relación existente ignorando mayúsculas/minúsculas y espacios en los extremos.
3. Reutiliza la relación o crea una nueva dentro de una transacción, coordinada con un advisory lock.
4. Permite asociar cuentas por plataforma; elimina duplicados del envío y valida IDs numéricos después de normalizarlos.
5. Rechaza una cuenta que ya esté asociada a otra relación.

La suspensión establece `enabled=false` y fecha de suspensión; la reactivación habilita la relación y limpia esa fecha. En las consultas de inversiones y líneas manuales, ADMIN sigue viendo las relaciones suspendidas; los demás roles reciben las líneas filtradas.

**Alcance de la suspensión:** es una regla de visibilidad en las consultas modificadas. No equivale a detener campañas externas ni garantiza detener su ingesta. La configuración de cuentas API habilitadas se administra por separado.

**Comportamiento del formulario “Editar”:** actualmente llama al mismo `POST /brand-mapping` que el alta, enviando cliente y marca. No renombra una relación por ID: al cambiar los nombres puede crear otra relación. Este límite se documenta tal como está implementado.

## 6. Cuentas publicitarias e integraciones

### Dos registros con propósitos distintos

| Tabla | Propósito |
| --- | --- |
| `brand_platform_accounts` | Asociar una cuenta a una relación anunciante/marca |
| `api_accounts` | Registrar las cuentas consultables por plataforma, con nombre opcional y estado habilitado |

Ambas tienen unicidad por `(platform, account_id)` y admiten `META`, `Google`, `TikTok` y `MELI`. La primera tiene una FK a `brand_mappings` con borrado en cascada.

La API incorpora listado, alta individual, alta por lote, actualización de nombre/estado, habilitación/deshabilitación y eliminación de cuentas API. El panel implementa el formulario de **carga por lote**; no presenta toda esa API como un CRUD visual completo.

El formulario acepta IDs separados por espacios, comas, punto y coma o saltos de línea. Envía `accountId` como array; el nombre opcional se aplica a todas las cuentas del lote. Los targets documentados son `meta`, `google`, `tiktok` y `mercado-libre`.

### Selección de cuentas para consultar métricas

Meta, Google, TikTok y Mercado Libre pasan a cargar cuentas habilitadas de `api_accounts`. Se normalizan sus identificadores y se eliminan duplicados antes de consultar.

Si no hay cuentas habilitadas de una plataforma y existen IDs legacy en el entorno, se usan esos IDs. También existe fallback al entorno cuando falla la lectura de cuentas. Para que PostgreSQL sea la única fuente de IDs hijos, deben retirarse las variables legacy correspondientes después de migrarlas.

En Mercado Libre se combina la configuración administrada con el fallback legacy cuando corresponde; se mantiene el descubrimiento previo de anunciantes según el flujo existente.

**Límite del mapeo explícito:** se añadieron puntos de consulta de mapeos por Account ID en los conectores, pero `loadManagedPlatformAccounts()` devuelve actualmente un `Map` de mapeos vacío. Por eso no debe darse por completada la resolución automática cuenta → anunciante/marca desde `brand_platform_accounts`; siguen interviniendo las reglas previas de nombres/referencias. Registrar una cuenta en `api_accounts` no garantiza por sí solo que supere los filtros de nombres de cada conector.

**Carga por lote:** el servicio crea las cuentas secuencialmente, sin una transacción que abarque todo el lote. Si una cuenta falla, las anteriores pueden quedar guardadas. Consultar el listado antes de repetir el lote completo.

## 7. Cambios en Control y asignación de métricas

La tabla de Control reduce tamaños de texto, padding y ancho de campaña. En escritorio utiliza layout fijo y elipsis; los valores y encabezados incorporan títulos emergentes para consultar contenido completo. Se ajustan anchos de desvío/acciones, altura mínima del botón de desvío y prioridad visual de los desplegables.

En `InvestmentsService` se elimina el fallback de coincidencia aproximada por nombre/tokens de Meta cuando la línea requiere coincidencia exacta de ad set. Si no hay una coincidencia válida, devuelve cero candidatos en lugar de aceptar un único candidato aproximado. También se retiran los logs de depuración de candidatos RHD y los helpers exclusivos de ese fallback.

Este cambio puede reducir coincidencias aparentes en líneas cuyos nombres no coinciden con los datos recibidos; no modifica los importes almacenados.

## 8. Exportación de base y limpieza

### Experiencia del administrador

Desde `/panel`, **Exportar Base de datos** inicia una operación única. La UI muestra progreso y bloquea nuevos clics mientras corre. El archivo descargado se llama `Media-pulse-${MES EN CURSO}.xlsx`, por ejemplo `Media-pulse-SEPTIEMBRE.xlsx`; el mes se calcula en UTC al iniciar la operación.

El nombre del botón se refiere a las siguientes cuatro tablas, no a todos los objetos del esquema:

| Tabla | Hoja Excel | Alcance |
| --- | --- | --- |
| `daily_metrics` | `daily_metrics` | Todos los registros; omite `impressions`, `clicks`, `conversions` y `revenue` |
| `manual_investment_deviation_comments` | `Comentarios` | Todos los registros y columnas |
| `manual_investment_lines` | `Lineas` | Todos los registros y columnas |
| `manual_investment_logs` | `Logs` | Todos los registros y columnas |

La omisión de esas cuatro columnas afecta al Excel; no elimina columnas de PostgreSQL. El respaldo JSON complementario conserva todos los campos originales. Las hojas incluyen encabezados, filtros y fila superior fija. Se conservan los valores como texto para evitar pérdida de precisión, identificadores o microsegundos; no son hojas de cálculo con importes convertidos para operar aritméticamente.

### Regla final de retención

Se conserva **el mes actual y los dos meses anteriores**, tomando `created_at` y UTC. El corte es el inicio del mes actual menos dos meses calendario. Se borra únicamente `created_at < corte`.

| Mes de ejecución | Conserva desde, inclusive | Meses vigentes |
| --- | --- | --- |
| Septiembre de 2026 | `2026-07-01 00:00:00+00` | Julio, agosto y septiembre |
| Octubre de 2026 | `2026-08-01 00:00:00+00` | Agosto, septiembre y octubre |
| Enero de 2027 | `2026-11-01 00:00:00+00` | Noviembre, diciembre y enero |

No se aplica una ventana móvil de 60/90 días ni se filtra por `mes` o por la fecha comercial de la métrica. Se conservan `created_at` nulos y fechas futuras. El Excel se genera con todas las filas **antes** de aplicar la limpieza.

### Secuencia y recuperación

1. La UI genera un UUID v4 y lo conserva localmente, asociado al usuario, antes de enviar el POST.
2. La API valida autenticación, rol y almacenamiento configurado.
3. Inicia una transacción y bloquea escrituras en las cuatro tablas; las lecturas siguen disponibles.
4. Comprueba relaciones entrantes, triggers y posibles comentarios vigentes que una cascada podría borrar.
5. Lee todas las filas, genera Excel y un archivo JSON con las filas serializadas por PostgreSQL.
6. Guarda y sincroniza los archivos, genera hashes SHA-256 y vuelve a leerlos para verificarlos.
7. Elimina las filas antiguas en el orden comentarios → logs → líneas → métricas y confirma la transacción.
8. Registra los conteos borrados y devuelve el Excel como attachment.

El archivo queda guardado en el servidor **antes** del DELETE. La descarga al navegador ocurre después de la transacción; no se afirma que el navegador haya terminado de guardar el archivo antes del borrado.

**Consultar y descargar respaldo** recupera el último ID y vuelve a descargar su archivo sin repetir la limpieza. Si se reenvía un POST con un ID utilizado, la API responde 409.

### Archivos y estado

| Archivo dentro de la carpeta del ID | Contenido |
| --- | --- |
| `backup.xlsx` | Excel para el usuario |
| `backup.json` | Filas originales completas como cadenas JSON serializadas por PostgreSQL |
| `prepared.json` | ID, administrador, fecha, corte, conteos exportados y hashes |
| `completed.json` | Estado final y conteos eliminados por tabla |

El estado `unconfirmed` indica que existe un respaldo preparado pero no consta el resultado final del borrado. Puede ocurrir por un fallo antes o después del COMMIT; se debe comprobar la base antes de iniciar otra operación. No hay reintento automático de borrado.

### Límites operativos

- Sin un directorio persistente absoluto configurado, el endpoint no limpia.
- Si falla generación, guardado o verificación del respaldo, no se inicia el DELETE.
- Ante errores de borrado anteriores al COMMIT se revierte la transacción completa.
- Se cancela si una inversión antigua tiene comentarios con fecha vigente o nula que serían borrados por cascada.
- Se rechazan otras relaciones entrantes no contempladas o triggers DELETE habilitados hasta revisar su impacto.
- El rol de conexión debe poder exportar todas las filas; se evita aceptar silenciosamente un subconjunto filtrado por RLS.
- Máximo actual: 100.000 filas por tabla y 32.767 caracteres por celda Excel. Si se supera, la operación falla sin limpiar.
- Espera de locks: 5 segundos. Timeout por sentencia: 120 segundos. La generación usa memoria; para mayor volumen se necesita streaming o un trabajo asíncrono.
- No se incluye DDL, índices, permisos ni restauración automática. Tampoco se programan ejecuciones ni se eliminan respaldos antiguos automáticamente.
- Exportar consume Egress. La limpieza no descuenta transferencia ya consumida y una ingesta posterior puede recrear datos históricos.

## 9. Endpoints nuevos o modificados funcionalmente

Todas las rutas administrativas de esta tabla requieren ADMIN, salvo las tres consultas autenticadas indicadas.

| Método | Ruta | Cambio |
| --- | --- | --- |
| GET | `/auth/me` | Validación mediante guard; usuario autenticado |
| GET | `/auth/users` | Listar usuarios activos |
| POST | `/auth/users` | Alta protegida por ADMIN |
| PUT | `/auth/users/:id` | Edición parcial por UUID v4 |
| DELETE | `/auth/users/:id` | Baja lógica; respuesta 204 |
| GET | `/brand-mapping/management` | Relaciones y cuentas para administración |
| POST | `/brand-mapping` | Alta/reutilización de relación y asociación opcional de cuentas |
| PATCH | `/brand-mapping/:id/suspension` | Suspender/reactivar con `{ "suspended": true/false }` |
| GET | `/brand-mapping/api-accounts` | Listar cuentas API |
| POST | `/brand-mapping/api-accounts` | Alta individual |
| POST | `/brand-mapping/api-accounts/:target` | Alta por lote y plataforma |
| PATCH | `/brand-mapping/api-accounts/:id` | Actualizar nombre/estado; no cambia ID externo ni plataforma |
| PATCH | `/brand-mapping/api-accounts/:id/enabled` | Habilitar/deshabilitar |
| DELETE | `/brand-mapping/api-accounts/:id` | Eliminar registro de cuenta API |
| GET | `/investments` | Ahora exige usuario y filtra suspendidos según rol |
| GET | `/investments/manual` | Ahora exige usuario y filtra suspendidos según rol |
| POST | `/maintenance/backups/:id/cleanup` | Respaldar, limpiar y devolver XLSX; UUID v4 único |
| GET | `/maintenance/backups/:id` | Consultar estado, corte, conteos y hashes |
| GET | `/maintenance/backups/:id/download` | Recuperar el Excel sin borrar |

El alta por lote recibe, por ejemplo, `{ "accountId": ["123456", "789012"], "accountName": "Cuenta operativa" }`. El alta individual incluye `platform` y un `accountId` string. El guardado de relación admite `accounts` o los campos `metaAccountId`, `googleAccountId`, `tiktokAccountId` y `mercadoLibreAccountId`.

En Swagger se agregan grupos funcionales para sistema, autenticación, usuarios, anunciantes/marcas, Credit Alloc, inversiones, carga manual, métricas, sincronización, Forecast, Control y TikTok; mantenimiento tiene su propio tag. Las modificaciones de tags en controladores preexistentes son organización documental, no nuevas funciones de esos endpoints.

CORS expone `Content-Disposition`, necesario para que la UI lea el nombre del archivo descargado desde otro origen.

## 10. Base de datos, configuración y despliegue

### Migraciones incluidas

Si `DB_SYNCHRONIZE=false`, aplicar las migraciones al esquema existente antes de desplegar la API. Las tablas base `users` y `brand_mappings` deben existir.

| Orden | Archivo | Efecto |
| --- | --- | --- |
| 1 | `20260903_admin_management.sql` | Crea `brand_platform_accounts` e índice por relación; agrega `suspended_at`; sustituye unicidad global de email por índice de usuarios activos |
| 2 | `20260903_advertiser_suspension.sql` | Agrega `suspended_at` si falta; compatible con el paso anterior |
| 3 | `20260903_api_accounts.sql` | Crea `api_accounts` e índice por plataforma/estado |
| 4 | `20260903_brand_mapping_enabled.sql` | Agrega `enabled` y marca como deshabilitadas las relaciones ya suspendidas |

Las migraciones están en `apps/api/migrations/` y contienen transacciones. El modo de sincronización también incorpora DDL de las nuevas entidades, pero no sustituye la revisión del esquema de producción.

### Entorno

| Configuración | Cambio |
| --- | --- |
| `RETENTION_BACKUP_DIR` | Nueva ruta absoluta a volumen privado y persistente; compartir entre réplicas de API |
| `JWT_SECRET` | Ahora requerido explícitamente en producción |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | El ejemplo distingue el MCC/login customer de los IDs hijos |
| IDs hijos de Meta, Google, TikTok y Mercado Libre | Se retiran del ejemplo de entorno y se orienta su administración a PostgreSQL; el código conserva fallback legacy |
| Tokens, secretos y contenedores padre | Continúan en el entorno; el panel no almacena ni rota esas credenciales |

No usar un directorio público, temporal o efímero para respaldos. El despliegue debe proporcionar permisos de lectura/escritura y un timeout HTTP adecuado. El volumen requiere su propia política de copia externa y retención.

### Dependencias y archivos auxiliares

- API agrega `@nestjs/jwt` y `exceljs`; elimina las dependencias directas `jsonwebtoken` y `@types/jsonwebtoken`.
- `package-lock.json` registra las dependencias nuevas y sus transitivas, normaliza el JSON y conserva entradas opcionales de plataforma.
- `.gitignore` excluye `/outputs/`, `/backups/` y `/apps/api/backups/`, para evitar versionar exportaciones, JSON de revisión y respaldos en esas ubicaciones.
- `apps/web/tsconfig.tsbuildinfo` cambia como metadato incremental generado, sin representar una función nueva.
- README incorpora administración, cuentas y requisitos de despliegue. `docs/backup-retention.md` detalla el flujo de respaldo.

## 11. Validación y límites de esta entrega

Se verificaron la compilación de API y web y las cuatro pruebas automatizadas de mantenimiento:

1. Corte de tres meses calendario, incluidos cambio de año y febrero bisiesto.
2. Omisión de las cuatro columnas de métricas, alineación de celdas y conservación del respaldo original.
3. Preservación de precisión, timestamps, JSON y cadenas que parecen fórmulas; rechazo de celdas demasiado largas.
4. Respaldo persistido antes del DELETE, bloqueo de IDs repetidos, protección de comentarios y rollback ante fallos simulados.

Comandos reproducibles:

```bash
npm --workspace @mediapulse/api run build
node --test apps/api/test/maintenance.test.cjs
npm --workspace @mediapulse/web run build
```

Durante el desarrollo del respaldo también se verificó el flujo en PostgreSQL temporal, con filas antiguas, en el límite y nulas, y con una cascada que debía bloquearse. Se probó la descarga y recuperación en navegador con API simulada. Esas comprobaciones auxiliares no son una suite de integración versionada ni prueban todas las integraciones externas de V2.

La revisión documental no ejecutó borrados ni migraciones en producción.

### Aclaraciones para no atribuir capacidades adicionales a V2

- El encabezado de versión de Swagger sigue indicando `0.0.1`, aunque los paquetes están en `2.0.0`.
- Los cambios de autorización cubren las rutas mencionadas; no convierten automáticamente todas las rutas existentes en protegidas por guards.
- La suspensión no es un control global de permisos sobre cada posible ruta de historial o métrica.
- El mapeo de cuentas, el formulario de edición de relaciones y el lote no atómico tienen los límites descritos en las secciones 5 y 6.
- Los respaldos no se programan solos ni restauran la base automáticamente.

## 12. Inventario de archivos del diff

El listado siguiente corresponde exactamente al rango `6fe9a6b..f9c193c`. A = agregado; M = modificado. Permite auditar el alcance sin incluir código anterior ya documentado.

| Estado | Archivo |
| --- | --- |
| M | `.env.example` |
| M | `.gitignore` |
| M | `README.md` |
| A | `apps/api/migrations/20260903_admin_management.sql` |
| A | `apps/api/migrations/20260903_advertiser_suspension.sql` |
| A | `apps/api/migrations/20260903_api_accounts.sql` |
| A | `apps/api/migrations/20260903_brand_mapping_enabled.sql` |
| M | `apps/api/package.json` |
| M | `apps/api/src/app.controller.ts` |
| M | `apps/api/src/app.module.ts` |
| M | `apps/api/src/common/brand-mapping/brand-mapping.controller.ts` |
| M | `apps/api/src/common/brand-mapping/brand-mapping.repository.ts` |
| M | `apps/api/src/common/brand-mapping/brand-mapping.service.ts` |
| A | `apps/api/src/common/brand-mapping/brand-mapping.types.ts` |
| A | `apps/api/src/common/brand-mapping/dto/create-api-account.dto.ts` |
| A | `apps/api/src/common/brand-mapping/dto/create-brand-mapping.dto.ts` |
| M | `apps/api/src/common/external-apis/external-apis.service.ts` |
| A | `apps/api/src/common/swagger/swagger-tags.ts` |
| M | `apps/api/src/config/config.service.ts` |
| M | `apps/api/src/main.ts` |
| M | `apps/api/src/modules/auth/auth.controller.ts` |
| M | `apps/api/src/modules/auth/auth.module.ts` |
| M | `apps/api/src/modules/auth/auth.repository.ts` |
| M | `apps/api/src/modules/auth/auth.service.ts` |
| A | `apps/api/src/modules/auth/dto/update-user.dto.ts` |
| A | `apps/api/src/modules/auth/guards/jwt-auth.guard.ts` |
| A | `apps/api/src/modules/auth/guards/roles.guard.ts` |
| A | `apps/api/src/modules/auth/roles.decorator.ts` |
| A | `apps/api/src/modules/auth/users.controller.ts` |
| M | `apps/api/src/modules/control/control.controller.ts` |
| M | `apps/api/src/modules/forecast/forecast.controller.ts` |
| M | `apps/api/src/modules/investments/investments.controller.ts` |
| M | `apps/api/src/modules/investments/investments.service.ts` |
| A | `apps/api/src/modules/maintenance/maintenance.controller.ts` |
| A | `apps/api/src/modules/maintenance/maintenance.module.ts` |
| A | `apps/api/src/modules/maintenance/maintenance.service.ts` |
| A | `apps/api/src/modules/maintenance/retention.ts` |
| M | `apps/api/src/modules/metrics/metrics.controller.ts` |
| A | `apps/api/test/maintenance.test.cjs` |
| A | `apps/web/app/components/AppSidebar.module.css` |
| A | `apps/web/app/components/AppSidebar.tsx` |
| M | `apps/web/app/components/InvestmentsApp.tsx` |
| M | `apps/web/app/globals.css` |
| A | `apps/web/app/panel/DatabaseExport.tsx` |
| A | `apps/web/app/panel/page.tsx` |
| A | `apps/web/app/panel/panel.module.css` |
| M | `apps/web/package.json` |
| M | `apps/web/tsconfig.tsbuildinfo` |
| A | `docs/backup-retention.md` |
| M | `package-lock.json` |
| M | `package.json` |
