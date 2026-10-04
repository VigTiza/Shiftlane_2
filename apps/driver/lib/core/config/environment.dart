/// Ambientes de la app. Se eligen al compilar:
/// `flutter run --dart-define-from-file=config/dev.json`.
enum AppEnvironment { dev, staging, prod }

/// Proyecto de Firebase para avisos con la app cerrada (valores públicos de la app de Android
/// en la consola de Firebase; no son secretos).
class FirebaseSettings {
  const FirebaseSettings({
    required this.apiKey,
    required this.appId,
    required this.messagingSenderId,
    required this.projectId,
  });

  final String apiKey;
  final String appId;
  final String messagingSenderId;
  final String projectId;
}

class AppConfig {
  const AppConfig({
    required this.environment,
    required this.apiBaseUrl,
    required this.locationIntervalSeconds,
    this.tileUrlTemplate = defaultTileUrl,
    this.firebase,
  });

  /// Mosaicos del mapa. En producción usar un proveedor que permita guardarlos en el
  /// celular (OpenStreetMap solo sirve para desarrollo).
  static const defaultTileUrl =
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

  /// URL por omisión de cada ambiente (dev apunta a la API local desde el emulador).
  static const Map<AppEnvironment, String> defaultApiUrls = {
    AppEnvironment.dev: 'http://10.0.2.2:3000',
    AppEnvironment.staging: 'https://api.staging.shiftlane.mx',
    AppEnvironment.prod: 'https://api.shiftlane.mx',
  };

  final AppEnvironment environment;
  final Uri apiBaseUrl;

  /// Cada cuántos segundos se envía la ubicación durante un viaje.
  final int locationIntervalSeconds;

  final String tileUrlTemplate;

  /// null: sin avisos push (los avisos llegan por tiempo real con la app abierta).
  final FirebaseSettings? firebase;

  bool get isProduction => environment == AppEnvironment.prod;

  /// Nombre del ambiente para mostrar (prod no muestra nada).
  String get label => switch (environment) {
    AppEnvironment.dev => 'Desarrollo',
    AppEnvironment.staging => 'Pruebas',
    AppEnvironment.prod => '',
  };

  /// Crea la configuración a partir de los valores de compilación.
  factory AppConfig.fromValues({
    String environment = 'dev',
    String apiUrl = '',
    String locationInterval = '',
    String tileUrl = '',
    String firebaseApiKey = '',
    String firebaseAppId = '',
    String firebaseSenderId = '',
    String firebaseProjectId = '',
  }) {
    final env = AppEnvironment.values.where((e) => e.name == environment);
    if (env.isEmpty) {
      throw ArgumentError.value(
        environment,
        'SHIFTLANE_ENV',
        'Debe ser dev, staging o prod',
      );
    }
    final url = apiUrl.isNotEmpty ? apiUrl : defaultApiUrls[env.first]!;
    final parsed = Uri.tryParse(url);
    if (parsed == null || !parsed.hasScheme || parsed.host.isEmpty) {
      throw ArgumentError.value(
        url,
        'SHIFTLANE_API_URL',
        'No es una URL válida',
      );
    }
    final interval = int.tryParse(locationInterval) ?? 12;
    return AppConfig(
      environment: env.first,
      apiBaseUrl: parsed,
      locationIntervalSeconds: interval.clamp(10, 15),
      tileUrlTemplate: tileUrl.isNotEmpty ? tileUrl : defaultTileUrl,
      firebase:
          [
            firebaseApiKey,
            firebaseAppId,
            firebaseSenderId,
            firebaseProjectId,
          ].every((v) => v.isNotEmpty)
          ? FirebaseSettings(
              apiKey: firebaseApiKey,
              appId: firebaseAppId,
              messagingSenderId: firebaseSenderId,
              projectId: firebaseProjectId,
            )
          : null,
    );
  }

  /// Lee los valores definidos con `--dart-define` o `--dart-define-from-file`.
  factory AppConfig.fromEnvironment() => AppConfig.fromValues(
    environment: const String.fromEnvironment(
      'SHIFTLANE_ENV',
      defaultValue: 'dev',
    ),
    apiUrl: const String.fromEnvironment('SHIFTLANE_API_URL'),
    locationInterval: const String.fromEnvironment(
      'SHIFTLANE_LOCATION_INTERVAL',
    ),
    tileUrl: const String.fromEnvironment('SHIFTLANE_TILE_URL'),
    firebaseApiKey: const String.fromEnvironment('FIREBASE_API_KEY'),
    firebaseAppId: const String.fromEnvironment('FIREBASE_APP_ID'),
    firebaseSenderId: const String.fromEnvironment('FIREBASE_SENDER_ID'),
    firebaseProjectId: const String.fromEnvironment('FIREBASE_PROJECT_ID'),
  );
}
