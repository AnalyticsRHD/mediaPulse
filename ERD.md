# ERD - MediaPulse RHD

El sistema contempla tres tablas principales que se conectan para permitir forecast, ejecución y control en tiempo real.

```mermaid
erDiagram
    CLIENT ||--o{ MONTHLY_CONTROL : "tiene"
    MONTHLY_CONTROL ||--o{ FORECAST_DETAIL : "contiene"
    FORECAST_DETAIL ||--o{ DAILY_METRICS : "colecciona"

    CLIENT {
      string id PK "Registro único (Airtable record ID)"
      string name
    }
    MONTHLY_CONTROL {
      string id PK
      string client_id FK
      string month
      number budget_original
      number budget_adjusted
      number consumo_total
      number resultados_totales
      number dias_del_mes
      number dia_actual
      number consumo_esperado
      number porcentaje_consumo
      number desvio_pacing
      string semaforo
      number consumo_restante
      text observaciones
    }
    FORECAST_DETAIL {
      string id PK
      string monthly_control_id FK
      string cliente
      string marca
      string plataforma
      string campaign_id
      string campaign_name
      string mes
      number budget
      number cpa_esperado
      number resultados_proyectados
    }
    DAILY_METRICS {
      string id PK
      date date
      string cliente
      string marca
      string plataforma
      string campaign_id
      string campaign_name
      number spend
      number impressions
      number clicks
      number conversions
      number revenue
    }
```

## Notas

- `Monthly Control` es el nivel de control por cliente + mes.
- `Forecast Detail` es el nivel táctico de presupuesto por marca/plataforma/campaña.
- `Daily Metrics` trae datos diarios de campaña desde APIs de Meta/Google.
- La relación clave se soporta con `campaign_id` y `cliente + mes`.
