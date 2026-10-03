# 0002 — Pruebas de la API con PostgreSQL real

- Fecha: 2026-10-03
- Estado: aceptada

## Contexto
El aislamiento entre empresas depende de la seguridad por filas de PostgreSQL y de PostGIS,
así que las pruebas deben correr contra un PostgreSQL real, no contra simulaciones.

## Decisión
`apps/api/test/global-setup.ts` prepara una base para cada corrida de pruebas:
- Si existe `TEST_DATABASE_URL`, crea una base temporal `shiftlane_test_<aleatorio>` en ese
  servidor y la borra al terminar. Se usa en la PC de desarrollo (PostgreSQL nativo o el de
  Docker Compose).
- Si no existe, levanta `postgis/postgis:16-3.5` con Testcontainers. Es lo que pasa en CI.
Las pruebas obtienen la conexión con `inject('databaseUrl')`.

## Consecuencias
- Las pruebas corren igual en Windows sin Docker y en CI.
- Cada corrida empieza con una base vacía; las migraciones se aplican en el mismo arranque.
