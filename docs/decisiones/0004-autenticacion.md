# 0004 — Autenticación de usuarios web, choferes y pasajeros

- Fecha: 2026-10-03
- Estado: aceptada (revisar con el dueño del producto)

## Decisión

### Tokens
- Acceso: JWT HS256 de 15 minutos (`JWT_SECRET`) con el tipo de sesión (`user`, `driver`,
  `passenger`), el tenant o empresa cliente y, para usuarios web, sus roles. El contexto de
  base de datos sale solo de este token.
- Renovación: token aleatorio de 256 bits; en la base solo se guarda su SHA-256. Cada uso
  entrega uno nuevo (rotación). Si alguien presenta un token ya usado, se revoca toda la
  familia de sesiones (detección de reutilización). Dos renovaciones simultáneas con el
  mismo token también cuentan como reutilización.
- Usuarios web y pasajeros reciben el token de renovación en una cookie `shiftlane_rt`
  httpOnly, SameSite=Strict, Path=/auth (Secure en producción). La app del chofer lo recibe
  en el cuerpo y lo guarda en almacenamiento seguro.
- Revocar sesiones surte efecto al siguiente intento de renovación (máximo 15 minutos).

### Usuarios web
- Contraseñas con argon2id (19 MiB, 2 iteraciones); mínimo 10 caracteres con letras y números.
- 5 intentos fallidos bloquean la cuenta 15 minutos (respuesta 423). Correo inexistente y
  contraseña incorrecta responden igual y tardan lo mismo.
- Recuperación por correo con enlace de un solo uso (30 minutos); al cambiar la contraseña
  se cierran todas las sesiones.
- 2FA opcional con TOTP (RFC 6238). El secreto se guarda cifrado con AES-256-GCM
  (`ENCRYPTION_KEY`) y un código no se acepta dos veces.

### Choferes
- El despachador genera un QR de un solo uso (24 horas). Al escanearlo se registra el
  celular, que recibe un secreto propio, y el chofer crea su PIN de 4 dígitos.
- El PIN solo sirve junto con el secreto del celular; 5 intentos fallidos lo bloquean.
- Un celular puede tener varios choferes (celular compartido entre turnos).
- Restablecer el PIN cierra las sesiones del chofer; en su celular ya vinculado crea uno
  nuevo sin escanear otro QR.

### Pasajeros
- Activación con el código de su planta (lo comparte RH) y su número de empleado,
  validado contra la lista que carga la planta. Activar en otro celular cierra la sesión
  anterior. La activación con QR de RH queda para F10-P01.

### Datos
- Las operaciones de autenticación usan `db.system`, porque ocurren antes de conocer la
  empresa; siempre filtran por el identificador que viene del token o del secreto.
- `password_reset_tokens` no tiene políticas para el rol de la API (solo el sistema).

## Pendiente
- Permisos por acción: F01-P04. Mientras tanto, las rutas del despachador se limitan por rol.
- Contexto propio del pasajero en la base de datos (`app.passenger_id`): F10.
