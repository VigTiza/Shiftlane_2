# 0003 — Multiempresa y seguridad por filas

- Fecha: 2026-10-03
- Estado: aceptada (revisar con el dueño del producto: es la base del aislamiento)

## Contexto
Cada transportista es una cuenta (tenant). Las plantas cliente son organizaciones propias
que pueden trabajar con varias transportistas y ven sus datos solo por medio de un acuerdo
de servicio. Una consulta que olvide filtrar no debe exponer datos de otra cuenta.

## Decisión

### Roles de base de datos
- `shiftlane_app` (NOLOGIN, sin BYPASSRLS): rol con el que corre la API. El pool lo fija
  al abrir cada conexión (`options: -c role=shiftlane_app`), así que una consulta sin
  contexto no ve ninguna fila.
- El usuario de `DATABASE_URL` es dueño de las tablas: corre las migraciones y, por medio
  de `db.system`, los procesos sin empresa (inicio de sesión, tareas programadas, consola).

### Contexto por petición
`withDbContext(db.app, { tenantId, clientOrgId, userId }, fn)` abre una transacción y fija
`app.tenant_id`, `app.client_org_id` y `app.user_id` con `set_config(..., true)` (equivale
a SET LOCAL). Las políticas leen esos valores con `app.current_tenant_id()` y similares.
El contexto sale siempre del token verificado en el servidor, nunca de la petición.

### Modelo de clientes
- `client_orgs` y `plants` son compartidas: una maquila es una sola organización aunque
  la atiendan varias transportistas, para que vea todo en un tablero.
- Una transportista ve una empresa cliente o planta si tiene un `service_agreement` con
  ella, o si la registró y la empresa aún no tiene usuarios propios (`claimed_at` nulo).
- Con una empresa que ya tiene usuarios, el acuerdo se crea por invitación (F02-P02):
  - La transportista invita por correo a la planta que registró. Al aceptar se crea el
    usuario de planta, la empresa queda «reclamada» (`claimed_at`) y la transportista ya no
    la edita; la sigue viendo por su acuerdo de servicio.
  - Si quien acepta ya es usuario de otra empresa cliente (la planta ya usa Shiftlane con
    otra transportista), acepta desde su cuenta eligiendo su planta real: se crea el acuerdo
    con esa planta y los contratos, contactos y prospectos que la transportista había
    capturado pasan a la empresa real; la empresa provisional queda archivada.
- Las pruebas de autorización corren en `onRequest`: sin permiso se responde 403 antes de
  leer o validar el cuerpo de la petición.
- Los datos comerciales de cada transportista (contactos, contratos, tarifas) van en tablas
  con `tenant_id`.

### Políticas
- Tablas operativas: `tenant_id = app.current_tenant_id()` para todo (lectura y escritura).
- Datos visibles para la planta: además, `client_org_id = app.current_client_org_id()` o
  la relación por acuerdo de servicio.
- Las consultas entre tablas dentro de una política usan funciones SECURITY DEFINER del
  esquema `app`, para evitar la recursión entre políticas.
- Disparadores: el ámbito de `user_roles` se copia del usuario y el rol debe ser del mismo
  ámbito (nadie se asigna `platform_admin`); los acuerdos no cambian de transportista ni de
  planta; la API no cambia quién administra una empresa cliente.
- La bitácora (`audit_log`) no admite UPDATE ni DELETE para el rol de la API.

### Reglas para tablas nuevas
1. Columna `tenant_id` (y `client_org_id` si la planta debe verla).
2. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` y políticas `TO shiftlane_app` en la misma
   migración.
3. La prueba "toda tabla de la aplicación tiene RLS" falla si se olvida el paso 2.

## Consecuencias
- El aislamiento no depende de que cada consulta filtre bien.
- Cada petición con datos corre dentro de una transacción.
- Las migraciones necesitan permiso CREATEROLE la primera vez (crean `shiftlane_app`); en
  producción el usuario dueño debe tenerlo o el rol se crea a mano antes de migrar.
