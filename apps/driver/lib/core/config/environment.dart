/// Ambientes de la app. Se eligen al compilar:
/// `flutter run --dart-define-from-file=config/dev.json`.
enum AppEnvironment { dev, staging, prod }

class AppConfig {
  const AppConfig({
    required this.environment,
    required this.apiBaseUrl,
    required this.locationIntervalSeconds,
  });

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
  );
}
