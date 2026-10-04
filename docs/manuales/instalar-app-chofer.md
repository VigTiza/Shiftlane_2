# Instalar la app del chofer (APK)

Este manual explica cómo generar el APK de la app del chofer, instalarlo en los celulares
Android de la transportista y dejarlo listo para el primer turno.

## 1. Qué APK usar

| APK | Para qué | Cómo se firma |
| --- | --- | --- |
| Staging (pruebas) | Probar con datos de prueba contra `api.staging.shiftlane.mx` | Llave de depuración (no sirve para publicar) |
| Producción | Celulares de los choferes | Llave de la empresa (`android/key.properties`) |

Un celular no puede pasar de un APK a otro firmado con otra llave: hay que desinstalar el
anterior antes de instalar el nuevo. Se pierden los datos guardados en el celular, así que
primero hay que sincronizar: abrir la app con señal y esperar a que desaparezca la franja
«Sin señal».

## 2. Generar el APK

Requisitos en la computadora: Flutter 3.47, JDK 21 y el SDK de Android (`flutter doctor`
debe marcar «Android toolchain» en verde).

```bash
cd apps/driver
flutter build apk --release --dart-define-from-file=config/staging.json
```

El archivo queda en `apps/driver/build/app/outputs/flutter-apk/app-release.apk`. Pesa unos
78 MB porque incluye todas las arquitecturas. Para enviar archivos más ligeros (unos 30 MB),
agregar `--split-per-abi` y repartir `app-arm64-v8a-release.apk`, que sirve para casi todos
los celulares actuales. Para producción se usa `config/prod.json`.

### Avisos con la app cerrada (Firebase)

Mientras no haya un proyecto de Firebase, los mensajes del despachador, las cancelaciones y
los cambios de ruta llegan solo con la app abierta (por tiempo real). Para que lleguen con la
app cerrada:

1. En la consola de Firebase, crear el proyecto y agregar una app de Android con el
   identificador `mx.shiftlane.shiftlane_driver`.
2. Copiar los valores de la app de Android al archivo de configuración del ambiente
   (`config/staging.json` o `config/prod.json`): `FIREBASE_API_KEY`, `FIREBASE_APP_ID`,
   `FIREBASE_SENDER_ID` y `FIREBASE_PROJECT_ID`. Son valores públicos de la app.
3. En la API, generar una cuenta de servicio del proyecto (Configuración › Cuentas de
   servicio › Generar clave privada) y ponerla en la variable `FIREBASE_SERVICE_ACCOUNT`
   (el JSON en base64). Esta sí es secreta: solo en el `.env` del servidor.
4. Volver a generar el APK.

### Firma de producción

Se hace una sola vez y la llave se guarda fuera del repositorio. Si se pierde, los choferes
tendrán que desinstalar la app para recibir actualizaciones.

```bash
keytool -genkey -v -keystore shiftlane-chofer.jks -keyalg RSA -keysize 2048 \
  -validity 10000 -alias shiftlane
```

Crear `apps/driver/android/key.properties`. Git ignora este archivo y el `.jks`:

```properties
storeFile=C:/ruta/segura/shiftlane-chofer.jks
storePassword=...
keyAlias=shiftlane
keyPassword=...
```

## 3. Instalar en el celular

**Opción A: enviar el archivo.**
1. Compartir el APK por un enlace de descarga o pasarlo con un cable.
2. En el celular, abrir el archivo. Android pedirá permitir «Instalar apps desconocidas»
   para el navegador o el administrador de archivos: activarlo.
3. Tocar «Instalar». Si aparece Play Protect, elegir «Instalar de todas formas».

**Opción B: con cable y `adb`** (útil para varios celulares):

```bash
adb install -r apps/driver/build/app/outputs/flutter-apk/app-release.apk
```

## 4. Primer uso de cada celular

1. El despachador genera el QR de alta del chofer en el panel (Choferes › Vincular celular).
2. En la app, «Vincular celular» → escanear el QR. Si es el primer celular del chofer, crea
   su PIN de 4 dígitos.
3. La revisión del celular pide los permisos uno por uno. Todos deben quedar en verde:
   - Ubicación: «Permitir todo el tiempo».
   - Batería: sin restricciones (la app guía el ajuste según la marca).
   - Cámara y notificaciones.
4. La primera vez aparece un tutorial de unos 2 minutos. Se puede volver a ver desde el menú.

En un celular compartido, cada chofer entra con su nombre y su PIN («Cambiar de chofer» en
el menú).

## 5. Actualizaciones

En la API (`.env`):
- `LATEST_DRIVER_APP_VERSION`: la app muestra «Hay una versión nueva» con el botón
  «Actualizar».
- `MIN_DRIVER_APP_VERSION`: con una versión menor, la app pide actualizar y no deja seguir.
  Si hay un viaje en curso, primero deja terminarlo.
- `DRIVER_APP_DOWNLOAD_URL`: el enlace del APK nuevo que abre el botón.

La versión de la app es la de `apps/driver/pubspec.yaml` (`version: 0.1.0+1`). Hay que subir
el número antes de cada entrega.

## 6. Si algo falla

En la app, el botón «Tengo un problema» explica las soluciones comunes (sin señal, GPS,
cámara, viaje que no aparece, PIN olvidado) y envía un diagnóstico al despachador. El
despachador lo ve en el panel de celulares.

## 7. Prueba integral (equipo de desarrollo)

Con la API local en marcha, `pnpm e2e:chofer` hace lo siguiente:
1. Crea una empresa de simulación.
2. La app de Flutter recorre un turno completo contra la API: alta, PIN, revisión,
   checklist con foto, inicio, GPS, escaneo, puerta y fin.
3. Al mismo tiempo, el simulador mueve al resto de la flota.
4. Al final verifica en el servidor que el viaje quedó terminado.
