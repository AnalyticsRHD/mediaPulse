# MediaPulse RHD

Monorepo inicial para un sistema vivo de planificación, ejecución y control de presupuestos.

## Arquitectura

- **Backend:** NestJS (`apps/api`)
- **Frontend:** Next.js (`apps/web`)
- **Tipos compartidos:** `packages/shared`

## Estructura de datos

- `Monthly Control`
- `Forecast Detail`
- `Daily Metrics`

## Cómo arrancar

```bash
npm install
npm run dev:api
npm run dev:web
```

## ERD

Ver `ERD.md` para el diagrama de entidad-relación.
