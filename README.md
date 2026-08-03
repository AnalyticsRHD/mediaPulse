# MediaPulse RHD

Plataforma interna para planificar inversiones publicitarias, consolidar consumos de múltiples plataformas y controlar el ritmo de ejecución mensual por cliente, marca y campaña.

> **Estado:** V1 operativa
>
> **Zona horaria de negocio:** `America/Argentina/Buenos_Aires`
> **Monorepo:** Next.js + NestJS + PostgreSQL

## Contenido

- [Alcance de V1](#alcance-de-v1)
- [Arquitectura](#arquitectura)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Flujos principales](#flujos-principales)
- [Modelo de datos](#modelo-de-datos)
- [Integraciones](#integraciones)
- [Ejecución local](#ejecución-local)
- [Variables de entorno](#variables-de-entorno)
- [API](#api)
- [Despliegue](#despliegue)
- [Operación y soporte](#operación-y-soporte)
- [Seguridad y limitaciones](#seguridad-y-limitaciones)

## Alcance de V1

MediaPulse permite:

- autenticar usuarios con roles `ADMIN`, `MEDIA` y `CLIENT`;
- cargar, editar, confirmar y auditar líneas de inversión manual;
- reutilizar valores de campañas del mes anterior;
- visualizar Control y Forecast por cliente o en vista general;
- filtrar consumos por hoy, ayer, mes actual, mes anterior o rango personalizado;
- consultar presupuesto, consumo acumulado, consumo diario, consumo de ayer, restante, porcentaje, ritmo y desvío;
- calcular costo por resultado, resultados proyectados y facturación proyectada;
- consolidar Google Ads, Meta, TikTok, Mercado Libre y LinkedIn;
- sincronizar cada fuente para el rango exacto solicitado;
- ejecutar una ingesta automática diaria y sincronizaciones manuales en segundo plano;
- conservar historial de cambios y comentarios de desvío.

## Arquitectura

```mermaid
flowchart LR
    U[Usuario] --> W[Next.js Web]
    W -->|REST + JWT| A[NestJS API]
    A --> P[(PostgreSQL)]
    A --> G[Google Ads]
    A --> M[Meta Ads]
    A --> T[TikTok Ads]
    A --> ML[Mercado Libre Ads]
    A --> S[Supermetrics / LinkedIn]
    A -. fallback .-> GS[Google Sheets]
    C[Scheduler 10:15 ART] --> A
```

| Capa | Tecnología | Responsabilidad |
| --- | --- | --- |
| Web | Next.js 15, React 18, TypeScript | Interfaz, filtros, carga manual, polling de sincronización |
| API | NestJS 10, TypeScript | Autenticación, reglas de negocio, cálculos e integraciones |
| Persistencia | PostgreSQL (`pg`) | Usuarios, planificación, métricas, auditoría y estado OAuth |
| Contratos | Workspace `@mediapulse/shared` | Modelos compartidos entre API y web |
| Automatización | `@nestjs/schedule` | Ingesta diaria a las 10:15 ART |

La API crea las tablas requeridas al inicializar sus repositorios. En V1 no existe todavía una herramienta formal de migraciones versionadas.

## Estructura del repositorio

```text
.
├── apps/
│   ├── api/                 # Backend NestJS
│   │   ├── data/            # Fallback local de estado OAuth
│   │   └── src/
│   │       ├── common/      # Integraciones, scheduler, filtros y brand mapping
│   │       ├── config/      # Configuración y pool PostgreSQL
│   │       └── modules/     # Auth, investments, metrics, control y forecast
│   └── web/                 # Frontend Next.js
│       └── app/
├── packages/
│   └── shared/              # Interfaces y enums compartidos
├── docs/
│   └── NOTION_V1.md         # Página preparada para importar en Notion
├── .env.example
├── package.json
└── vercel.json
```

## Flujos principales

### Carga y aprobación de presupuesto

1. `ADMIN` o `MEDIA` crea una línea para un mes.
2. Se registran anunciante, marca, plataforma, objetivo, campaña, moneda, presupuesto, costo por resultado y ticket promedio.
3. La línea inicia en `EN_PROCESO`.
4. Al validar la planificación pasa a `PRESUPUESTO_OK`.
5. Cada alta, edición o baja queda registrada en el historial.

Las sugerencias de autocompletado toman exclusivamente el mes calendario anterior al mes que se está cargando.

### Consulta de consumo

1. La web envía `startDate` y `endDate` seleccionados.
2. La API consulta cada plataforma con ese mismo rango.
3. Las respuestas se normalizan como métricas diarias.
4. Se hace `upsert` por fecha, campaña y plataforma.
5. La inversión manual se cruza con las métricas y se calculan los indicadores.

El rango es inclusivo y usa fechas `YYYY-MM-DD`. La semántica del calendario y los cortes operativos corresponden a Buenos Aires.

### Sincronización en segundo plano

`POST /metrics/sync/date-range/start` inicia la tarea y responde sin esperar a todas las APIs. La web consulta `GET /metrics/sync/status?key=consumption` hasta obtener `success` o `failed`. Esto evita mantener una solicitud HTTP abierta durante varios minutos.

La ejecución automática corre diariamente a las **10:15 ART** y recupera el acumulado mensual y el detalle del día anterior.

## Modelo de datos

| Tabla | Propósito |
| --- | --- |
| `users` | Credenciales, identidad y rol |
| `brand_mappings` | Relación entre nombres de cliente y marca |
| `manual_investment_lines` | Presupuestos y datos planificados por mes |
| `manual_investment_logs` | Auditoría de altas, cambios y bajas |
| `manual_investment_deviation_comments` | Comentarios operativos de desvíos |
| `daily_metrics` | Métricas normalizadas por fecha, plataforma y campaña |
| `mercado_libre_oauth_state` | Access token, refresh token y expiración vigentes |

### Monedas y estados

- Monedas soportadas por el modelo actual: `ARS`, `USD`, `CHL`.
- Estados de inversión: `EN_PROCESO`, `PRESUPUESTO_OK`.
- Las bajas manuales son lógicas mediante `deleted_at`.

### Indicadores principales

| Indicador | Definición |
| --- | --- |
| Consumo | Suma del gasto reportado en el rango |
| Restante | Presupuesto menos consumo |
| % consumo | Consumo dividido presupuesto |
| Ritmo | Proporción transcurrida del período |
| Nuevo presupuesto diario | Restante dividido días restantes |
| Desvío | Diferencia entre ejecución real y ritmo esperado |
| Resultados proyectados | Presupuesto dividido costo por resultado |
| FC proyectada | Resultados proyectados multiplicados por ticket promedio |

## Integraciones

| Fuente | Mecanismo V1 | Observaciones |
| --- | --- | --- |
| Google Ads | API oficial con OAuth | Acepta múltiples customer IDs |
| Meta Ads | Marketing API | Acepta múltiples account IDs |
| TikTok Ads | Business API | Acepta múltiples advertiser IDs |
| Mercado Libre | API oficial, productos PADS/DSP | OAuth se refresca y persiste en PostgreSQL |
| LinkedIn Ads | Supermetrics | Consulta configurada mediante JSON |
| Google Sheets | Fuente/fallback configurable | Usado cuando una integración lo requiere |

Mercado Libre no debe depender de actualizar tokens manualmente en las variables de producción. Después del primer inicio válido, la API guarda el estado OAuth renovado en `mercado_libre_oauth_state`; el archivo configurado es sólo un fallback.

## Ejecución local

### Requisitos

- Node.js 20 LTS recomendado;
- npm 10 o compatible con workspaces;
- PostgreSQL 14 o superior;
- credenciales de las plataformas que se quieran sincronizar.

### Instalación

```bash
npm install
```

Copiar `.env.example` a `.env` en la raíz y completar, como mínimo:

```dotenv
DATABASE_URL=postgresql://user:password@localhost:5432/mediapulse
DB_SSL=false
JWT_SECRET=una_clave_larga_y_aleatoria
```

Para la web, crear `apps/web/.env.local`:

```dotenv
NEXT_PUBLIC_API_BASE=http://localhost:3333
```

Iniciar ambos servicios:

```bash
npm run dev
```

O iniciarlos por separado:

```bash
npm run dev:api
npm run dev:web
```

Direcciones locales:

- Web: `http://localhost:3000`
- API: `http://localhost:3333`
- Swagger: `http://localhost:3333/api/docs`
- Health check: `http://localhost:3333/health`

### Compilación

```bash
npm --workspace @mediapulse/api run build
npm --workspace @mediapulse/web run build
```

## Variables de entorno

La referencia completa y segura para copiar está en [`.env.example`](.env.example). Nunca confirmar secretos reales al repositorio.

### Base

| Variable | Uso | Valor recomendado |
| --- | --- | --- |
| `PORT` / `API_PORT` | Puerto HTTP de la API | `3333` local |
| `NODE_ENV` | Entorno de ejecución | `development` / `production` |
| `DATABASE_URL` | Conexión PostgreSQL | Requerida |
| `DB_SSL` | TLS para PostgreSQL | `true` en servicios administrados |
| `DB_POOL_MAX` | Máximo de conexiones del proceso | `5` |
| `DB_POOL_IDLE_TIMEOUT_MS` | Cierre de conexiones ociosas | `10000` |
| `DB_POOL_CONNECTION_TIMEOUT_MS` | Espera máxima de conexión | `30000` |
| `JWT_SECRET` | Firma de sesiones | Requerida y aleatoria en producción |
| `JWT_EXPIRES_IN` | Duración del JWT | `8h` |
| `NEXT_PUBLIC_API_BASE` | URL pública del backend | Requerida en la web |

### Plataformas

Las familias utilizadas son:

- `GOOGLE_ADS_*` para Google Ads;
- `META_*` para Meta;
- `TIKTOK_*` para TikTok;
- `MERCADO_LIBRE_*` para Mercado Libre;
- `SUPERMETRICS_*` para LinkedIn/Supermetrics;
- `ADS_SHEETS_*`, `GOOGLE_SHEETS_API_KEY` y rangos `*_SHEETS_*` para Sheets.

Los IDs múltiples se separan por coma. Los JSON de Supermetrics deben ser JSON válido en una sola línea.

## API

La especificación interactiva se genera en `/api/docs`.

| Grupo | Rutas principales | Función |
| --- | --- | --- |
| Salud | `GET /health` | Estado básico del proceso |
| Auth | `/auth/login`, `/auth/me`, `/auth/users` | Sesión y usuarios |
| Investments | `/investments`, `/investments/manual` | Tablero y planificación |
| Metrics | `/metrics`, `/metrics/range`, `/metrics/sync/*` | Métricas y sincronización |
| Brand mapping | `/brand-mapping/*` | Clientes y marcas |
| Forecast | `/forecast/*` | Proyecciones |
| Control | `/control/*` | Control de inversiones |

Las rutas protegidas reciben:

```http
Authorization: Bearer <token>
```

Los DTO se validan globalmente: las propiedades desconocidas son rechazadas.

## Despliegue

La topología utilizada en V1 es:

- **Frontend:** Vercel, construido desde `apps/web`;
- **Backend:** Render, servicio Node;
- **Base de datos:** PostgreSQL accesible por `DATABASE_URL`.

### Checklist de release

1. Compilar API y web localmente.
2. Confirmar que no se incluyeron secretos ni archivos `.env`.
3. Verificar que las variables del proveedor coincidan con `.env.example`.
4. Desplegar backend y validar `/health` y `/api/docs`.
5. Desplegar frontend con `NEXT_PUBLIC_API_BASE` apuntando al backend.
6. Iniciar sesión con un usuario de prueba.
7. Sincronizar un rango corto y revisar el estado de todas las fuentes.
8. Comparar una campaña y fecha contra la plataforma de origen.
9. Validar un rango personalizado y el preset equivalente.

Los cambios en `.env` sólo son necesarios al incorporar o rotar credenciales/configuración. Los tokens renovables de Mercado Libre se actualizan en PostgreSQL.

## Operación y soporte

### Sincronización queda ejecutándose

1. Consultar `GET /metrics/sync/status?key=consumption`.
2. Revisar logs del backend por plataforma.
3. Identificar si una única fuente agotó su timeout.
4. Probar un rango corto para aislar el proveedor.
5. No aumentar indiscriminadamente el pool: una sincronización debe reutilizar conexiones y procesar cada fuente de manera controlada.

### Un filtro devuelve siempre el mismo consumo

- confirmar que la web envía ambos extremos del rango;
- verificar que la fuente recibió `startDate` y `endDate`;
- evitar reutilizar un snapshot mensual para un rango personalizado;
- comparar preset y personalizado usando exactamente las mismas fechas;
- revisar zona horaria y condición inclusiva del día final.

### Mercado Libre difiere del panel

- validar advertiser y producto (`PADS`/`DSP`);
- comprobar que la agregación sea diaria;
- revisar vigencia del OAuth persistido;
- comparar la misma cuenta, moneda y rango;
- evitar sumar una respuesta parcial si una página o cuenta falló.

### Base de datos

- revisar errores `timeout exceeded when trying to connect`;
- confirmar disponibilidad y límite de conexiones del proveedor;
- mantener `DB_POOL_MAX=5` como base para instancias pequeñas;
- no usar `DB_DROP_SCHEMA=true` en producción.

## Seguridad y limitaciones

### Controles existentes

- JWT firmado y expiración configurable;
- validación global de DTO;
- edición manual restringida a `ADMIN` y `MEDIA`;
- auditoría de cambios;
- secretos fuera del código;
- consultas SQL parametrizadas en repositorios.

### Deuda técnica conocida de V1

- las contraseñas usan SHA-256; migrar a Argon2 o bcrypt con salt;
- `POST /auth/users` debe restringirse explícitamente a administradores;
- CORS está abierto y debe limitarse a dominios permitidos;
- faltan migraciones de base de datos versionadas;
- faltan suites automatizadas unitarias, de integración y end-to-end;
- el estado de sincronización en memoria no se comparte entre réplicas;
- `CHL` es el identificador histórico de moneda chilena y conviene migrarlo a `CLP`;
- agregar observabilidad centralizada, reintentos y métricas por proveedor.

## Documentación relacionada

- [Documento para Notion V1](docs/NOTION_V1.md)
- [Referencia de endpoints existente](API_ENDPOINTS.md)
- [ERD existente](ERD.md)

`API_ENDPOINTS.md` y `ERD.md` son documentos históricos: antes de usarlos como contrato definitivo deben contrastarse con Swagger y el esquema actual.
