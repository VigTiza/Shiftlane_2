/// Lo que se revisa del celular antes del turno.
enum CheckItem {
  locationService,
  locationAlways,
  batteryOptimization,
  battery,
  mobileData,
  clock,
  camera,
  appVersion,
}

/// ok: en verde; warning: se avisa pero se puede seguir; problem: no se puede iniciar.
enum CheckStatus { ok, warning, problem }

enum LocationPermission { always, whileInUse, denied }

enum NetworkType { wifi, cellular, none }

enum PhoneBrand { samsung, motorola, xiaomi, generic }

PhoneBrand brandFrom(String manufacturer) {
  final name = manufacturer.toLowerCase();
  if (name.contains('samsung')) return PhoneBrand.samsung;
  if (name.contains('motorola') || name.contains('lenovo')) {
    return PhoneBrand.motorola;
  }
  if (name.contains('xiaomi') ||
      name.contains('redmi') ||
      name.contains('poco')) {
    return PhoneBrand.xiaomi;
  }
  return PhoneBrand.generic;
}

/// Lecturas del celular (las da el sistema; en pruebas se simulan).
class DeviceReadings {
  const DeviceReadings({
    required this.locationServiceEnabled,
    required this.locationPermission,
    required this.batteryOptimizationIgnored,
    required this.batteryLevel,
    required this.charging,
    required this.network,
    required this.cameraGranted,
    required this.appVersion,
    required this.manufacturer,
    required this.model,
    required this.osVersion,
  });

  final bool locationServiceEnabled;
  final LocationPermission locationPermission;
  final bool batteryOptimizationIgnored;
  final int batteryLevel;
  final bool charging;
  final NetworkType network;
  final bool cameraGranted;
  final String appVersion;
  final String manufacturer;
  final String model;
  final String osVersion;

  PhoneBrand get brand => brandFrom(manufacturer);

  /// Reporte para `/driver/health`.
  Map<String, Object?> toHealthReport(DateTime at) => {
    'recordedAt': at.toUtc().toIso8601String(),
    'batteryPct': batteryLevel,
    'charging': charging,
    'networkType': network.name,
    'signalLevel': network == NetworkType.none ? 0 : null,
    'mobileDataEnabled': network != NetworkType.none,
    'locationPermission': switch (locationPermission) {
      LocationPermission.always => 'always',
      LocationPermission.whileInUse => 'while_in_use',
      LocationPermission.denied => 'denied',
    },
    'gpsEnabled': locationServiceEnabled,
    'backgroundAllowed': locationPermission == LocationPermission.always,
    'batteryOptimizationIgnored': batteryOptimizationIgnored,
    'cameraPermission': cameraGranted,
    'appVersion': appVersion,
    'osVersion': osVersion,
    'platform': 'android',
    'deviceModel': '$manufacturer $model'.trim(),
  }..removeWhere((key, value) => value == null);
}

/// Cómo se arregla cada punto.
enum FixAction {
  openLocationSettings,
  requestLocationAlways,
  disableBatteryOptimization,
  chargePhone,
  openDataSettings,
  openDateSettings,
  requestCamera,
  updateApp,
}

class CheckResult {
  const CheckResult(this.item, this.status, this.message, {this.fix});

  final CheckItem item;
  final CheckStatus status;
  final String message;
  final FixAction? fix;
}

const _labels = {
  CheckItem.locationService: 'Ubicación activada',
  CheckItem.locationAlways: 'Permiso de ubicación «siempre»',
  CheckItem.batteryOptimization: 'Fuera del ahorro de batería',
  CheckItem.battery: 'Batería suficiente',
  CheckItem.mobileData: 'Datos móviles',
  CheckItem.clock: 'Hora correcta',
  CheckItem.camera: 'Cámara para escanear',
  CheckItem.appVersion: 'App actualizada',
};

String checkLabel(CheckItem item) => _labels[item]!;

/// Resultado de la revisión completa.
class DeviceCheckReport {
  const DeviceCheckReport({
    required this.results,
    required this.brand,
    required this.checkedAt,
    this.confirmedByServer = false,
  });

  final List<CheckResult> results;
  final PhoneBrand brand;
  final DateTime checkedAt;

  /// El servidor revisó la hora y la versión (sin señal solo hay revisión local).
  final bool confirmedByServer;

  CheckStatus get status => results.any((r) => r.status == CheckStatus.problem)
      ? CheckStatus.problem
      : results.any((r) => r.status == CheckStatus.warning)
      ? CheckStatus.warning
      : CheckStatus.ok;

  bool get canStartTrip => status != CheckStatus.problem;

  CheckResult result(CheckItem item) =>
      results.firstWhere((r) => r.item == item);

  /// Agrega lo que solo sabe el servidor (hora desfasada, versión mínima).
  DeviceCheckReport withServerIssues(
    List<({String code, String severity, String message})> issues,
  ) {
    final merged = [...results];
    for (final issue in issues) {
      final item = serverIssueItems[issue.code];
      if (item == null) continue;
      final index = merged.indexWhere((r) => r.item == item);
      final status = issue.severity == 'block'
          ? CheckStatus.problem
          : CheckStatus.warning;
      if (index >= 0 && merged[index].status.index < status.index) {
        merged[index] = CheckResult(
          item,
          status,
          issue.message,
          fix: _fixFor(item),
        );
      }
    }
    return DeviceCheckReport(
      results: merged,
      brand: brand,
      checkedAt: checkedAt,
      confirmedByServer: true,
    );
  }
}

/// Códigos de problema del servidor (POST /driver/health) y el punto que afectan.
const serverIssueItems = {
  'location_permission': CheckItem.locationAlways,
  'background_blocked': CheckItem.locationAlways,
  'gps_disabled': CheckItem.locationService,
  'battery_optimization': CheckItem.batteryOptimization,
  'battery_critical': CheckItem.battery,
  'battery_low': CheckItem.battery,
  'camera_permission': CheckItem.camera,
  'outdated_app': CheckItem.appVersion,
  'no_connection': CheckItem.mobileData,
  'clock_skew': CheckItem.clock,
};

FixAction? _fixFor(CheckItem item) => switch (item) {
  CheckItem.locationService => FixAction.openLocationSettings,
  CheckItem.locationAlways => FixAction.requestLocationAlways,
  CheckItem.batteryOptimization => FixAction.disableBatteryOptimization,
  CheckItem.battery => FixAction.chargePhone,
  CheckItem.mobileData => FixAction.openDataSettings,
  CheckItem.clock => FixAction.openDateSettings,
  CheckItem.camera => FixAction.requestCamera,
  CheckItem.appVersion => FixAction.updateApp,
};

/// Batería por debajo de la cual no se puede iniciar sin cargador (igual que el servidor).
const criticalBattery = 10;
const lowBattery = 20;

/// Revisión local, con las mismas reglas del servidor. La hora y la versión mínima las
/// confirma el servidor al recibir el reporte.
DeviceCheckReport evaluateDevice(DeviceReadings r, {DateTime? now}) {
  CheckResult ok(CheckItem item) =>
      CheckResult(item, CheckStatus.ok, checkLabel(item));
  CheckResult bad(CheckItem item, CheckStatus status, String message) =>
      CheckResult(item, status, message, fix: _fixFor(item));

  return DeviceCheckReport(
    brand: r.brand,
    checkedAt: now ?? DateTime.now(),
    results: [
      r.locationServiceEnabled
          ? ok(CheckItem.locationService)
          : bad(
              CheckItem.locationService,
              CheckStatus.problem,
              'La ubicación está apagada: actívala.',
            ),
      r.locationPermission == LocationPermission.always
          ? ok(CheckItem.locationAlways)
          : bad(
              CheckItem.locationAlways,
              CheckStatus.problem,
              'Permite la ubicación «Todo el tiempo» para que se vea tu recorrido.',
            ),
      r.batteryOptimizationIgnored
          ? ok(CheckItem.batteryOptimization)
          : bad(
              CheckItem.batteryOptimization,
              CheckStatus.problem,
              'El ahorro de batería puede cerrar la app: quítala del ahorro de batería.',
            ),
      if (r.charging || r.batteryLevel >= lowBattery)
        ok(CheckItem.battery)
      else if (r.batteryLevel < criticalBattery)
        bad(
          CheckItem.battery,
          CheckStatus.problem,
          'Batería muy baja (${r.batteryLevel} %): conecta el cargador de la unidad.',
        )
      else
        bad(
          CheckItem.battery,
          CheckStatus.warning,
          'Batería baja (${r.batteryLevel} %): conecta el cargador de la unidad.',
        ),
      r.network != NetworkType.none
          ? ok(CheckItem.mobileData)
          : bad(
              CheckItem.mobileData,
              CheckStatus.warning,
              'Sin conexión de datos: puedes seguir, tus datos se guardan en el celular.',
            ),
      ok(CheckItem.clock),
      r.cameraGranted
          ? ok(CheckItem.camera)
          : bad(
              CheckItem.camera,
              CheckStatus.problem,
              'Da permiso de cámara para escanear gafetes.',
            ),
      ok(CheckItem.appVersion),
    ],
  );
}

/// El chofer puede iniciar si todo está en verde o el despachador autorizó la salida.
bool mayStartTrip(
  DeviceCheckReport? report, {
  bool dispatcherException = false,
}) => dispatcherException || (report?.canStartTrip ?? false);

/// Lee el estado del celular (lo implementa la capa de datos con los plugins del sistema).
abstract interface class DeviceProbe {
  Future<DeviceReadings> read();
}

/// Ejecuta el arreglo de un punto (pide un permiso o abre la pantalla de ajustes exacta).
abstract interface class DeviceFixer {
  Future<void> fix(FixAction action);
}
