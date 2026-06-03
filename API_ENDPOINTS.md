# API Endpoints - MediaPulse RHD

## Base URL: http://localhost:3333

---

## 🟢 Forecast Module

### GET /forecast
Obtiene todos los forecast.
```bash
curl http://localhost:3333/forecast
```

### GET /forecast/overview
Resumen general de forecasts.
```bash
curl http://localhost:3333/forecast/overview
```

### GET /forecast/:id
Obtiene un forecast por ID.
```bash
curl http://localhost:3333/forecast/{id}
```

### GET /forecast/client/:cliente/month/:mes
Obtiene forecast por cliente y mes.
```bash
curl http://localhost:3333/forecast/client/fresh-up/month/2026-05
```

### POST /forecast
Crea un nuevo forecast.
```bash
curl -X POST http://localhost:3333/forecast \
  -H "Content-Type: application/json" \
  -d '{
    "cliente": "Fresh Up",
    "marca": "Fresh Up",
    "plataforma": "Meta",
    "campaña": "Ventas",
    "mes": "2026-05",
    "budget": 1200000,
    "cpaEsperado": 50,
    "resultadosProyectados": 24000
  }'
```

### PUT /forecast/:id
Actualiza un forecast.
```bash
curl -X PUT http://localhost:3333/forecast/{id} \
  -H "Content-Type: application/json" \
  -d '{
    "budget": 1300000,
    "cpaEsperado": 48
  }'
```

### DELETE /forecast/:id
Elimina un forecast.
```bash
curl -X DELETE http://localhost:3333/forecast/{id}
```

---

## 🔵 Control Module (Monthly Control)

### GET /control
Obtiene todos los controles mensuales.
```bash
curl http://localhost:3333/control
```

### GET /control/health
Status de ejemplo.
```bash
curl http://localhost:3333/control/health
```

### GET /control/:id
Obtiene un control por ID.
```bash
curl http://localhost:3333/control/{id}
```

### GET /control/client/:clientId/month/:month
Obtiene control por cliente y mes.
```bash
curl http://localhost:3333/control/client/fresh-up/month/2026-05
```

### POST /control
Crea un nuevo control mensual.
```bash
curl -X POST http://localhost:3333/control \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "fresh-up",
    "month": "2026-05",
    "budgetOriginal": 3000000,
    "budgetAdjusted": 3000000,
    "observaciones": "Control inicial para Fresh Up"
  }'
```

### PUT /control/:id
Actualiza un control mensual.
```bash
curl -X PUT http://localhost:3333/control/{id} \
  -H "Content-Type: application/json" \
  -d '{
    "budgetAdjusted": 2800000,
    "observaciones": "Presupuesto ajustado"
  }'
```

### DELETE /control/:id
Elimina un control.
```bash
curl -X DELETE http://localhost:3333/control/{id}
```

---

## 📊 Metrics Module (Daily Metrics)

### GET /metrics
Obtiene todas las métricas diarias.
```bash
curl http://localhost:3333/metrics
```

### GET /metrics/range?startDate=2026-05-01&endDate=2026-05-31
Obtiene métricas por rango de fechas.
```bash
curl "http://localhost:3333/metrics/range?startDate=2026-05-01&endDate=2026-05-31"
```

### GET /metrics/campaign/:campaignId
Obtiene métricas por campaña.
```bash
curl http://localhost:3333/metrics/campaign/campaign-123
```

### GET /metrics/client/:cliente/date/:date
Obtiene métricas por cliente y fecha.
```bash
curl http://localhost:3333/metrics/client/fresh-up/date/2026-05-18
```

### GET /metrics/summary/:cliente/:date
Resumen de métricas para un cliente en una fecha.
```bash
curl http://localhost:3333/metrics/summary/fresh-up/2026-05-18
```

### GET /metrics/:id
Obtiene una métrica por ID.
```bash
curl http://localhost:3333/metrics/{id}
```

### POST /metrics
Crea una nueva métrica diaria.
```bash
curl -X POST http://localhost:3333/metrics \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-05-18",
    "cliente": "Fresh Up",
    "marca": "Fresh Up",
    "plataforma": "Meta",
    "campaignId": "campaign-123",
    "campaignName": "Ventas Meta",
    "spend": 50000,
    "impressions": 500000,
    "clicks": 15000,
    "conversions": 300,
    "revenue": 150000
  }'
```

### POST /metrics/upsert
Crea o actualiza una métrica (por date + campaignId + platform).
```bash
curl -X POST http://localhost:3333/metrics/upsert \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-05-18",
    "cliente": "Fresh Up",
    "marca": "Fresh Up",
    "plataforma": "Meta",
    "campaignId": "campaign-123",
    "campaignName": "Ventas Meta",
    "spend": 52000,
    "impressions": 510000,
    "clicks": 16000,
    "conversions": 310,
    "revenue": 155000
  }'
```

### PUT /metrics/:id
Actualiza una métrica.
```bash
curl -X PUT http://localhost:3333/metrics/{id} \
  -H "Content-Type: application/json" \
  -d '{
    "spend": 55000,
    "conversions": 320
  }'
```

### DELETE /metrics/:id
Elimina una métrica.
```bash
curl -X DELETE http://localhost:3333/metrics/{id}
```

---

## ⏰ Scheduler & Ingestión

### Manual Trigger de Ingestión
*Endpoint para testing (aún no implementado - agregar si es necesario)*

El sistema corre automáticamente a las **6 AM (zona horaria ARG)** diariamente:
- Obtiene métricas de Meta
- Obtiene métricas de Google
- Upsert en base local
- Sincroniza con Airtable (si está configurado)

Para activar manualmente, crear endpoint:
```bash
POST /scheduler/ingest-now
```

---

## 🏥 Health Check

### GET /health
Status general de la API.
```bash
curl http://localhost:3333/health
```

---

## ⚙️ Configuración

### Variables de Entorno requeridas

Copiar `.env.example` a `.env` y completar:

```bash
cp .env.example .env
```

**Requeridas:**
- `AIRTABLE_API_KEY` - Tu personal access token de Airtable
- `AIRTABLE_BASE_ID` - ID de tu base Airtable
- `META_ACCESS_TOKEN` - Token de acceso Meta (opcional si no usas Meta)
- `GOOGLE_ACCESS_TOKEN` - Token de acceso Google (opcional si no usas Google)

**Opcionales:**
- `API_PORT` - Puerto del API (default: 3333)
- `NODE_ENV` - development | production

---

## 📝 Notes

- Todos los IDs son generados con UUID v4
- Las métricas se pueden upsert por clave única: `date + campaignId + platform`
- El semáforo en Control se calcula automáticamente basado en `desvioPacing`
  - 🟢 si |desvioPacing| <= 15%
  - 🟡 si |desvioPacing| <= 30%
  - 🔴 si |desvioPacing| > 30%
- Si Airtable no está configurado, el sistema funciona en modo local (memory) sin sincronización

