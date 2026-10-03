/// Credenciales del celular: lo identifican ante la API (se guardan cifradas).
class DeviceCredentials {
  const DeviceCredentials({required this.deviceId, required this.secret});

  final String deviceId;
  final String secret;

  Map<String, Object?> toJson() => {
    'deviceId': deviceId,
    'deviceSecret': secret,
  };
}

/// Chofer vinculado a este celular (un celular puede ser compartido entre turnos).
class LinkedDriver {
  const LinkedDriver({
    required this.id,
    required this.fullName,
    required this.pinSet,
  });

  final String id;
  final String fullName;

  /// Si el despachador restableció el PIN, el chofer debe crear uno nuevo.
  final bool pinSet;
}

/// Sesión del chofer que está usando el celular.
class DriverSession {
  const DriverSession({
    required this.driverId,
    required this.fullName,
    required this.accessToken,
    required this.refreshToken,
  });

  final String driverId;
  final String fullName;
  final String accessToken;
  final String refreshToken;

  DriverSession withTokens({
    required String accessToken,
    required String refreshToken,
  }) => DriverSession(
    driverId: driverId,
    fullName: fullName,
    accessToken: accessToken,
    refreshToken: refreshToken,
  );
}

/// Tokens que entrega la API al entrar o renovar.
class AuthTokens {
  const AuthTokens({required this.accessToken, required this.refreshToken});

  final String accessToken;
  final String refreshToken;
}

/// Resultado de escanear el QR de alta.
class EnrollResult {
  const EnrollResult({
    required this.tokens,
    required this.driverId,
    required this.fullName,
    required this.deviceId,
    this.newDeviceSecret,
  });

  final AuthTokens tokens;
  final String driverId;
  final String fullName;
  final String deviceId;

  /// Solo cuando el celular se registra por primera vez.
  final String? newDeviceSecret;
}

/// El código del QR de alta (`shiftlane-chofer://vincular?codigo=...`) o el código escrito.
String? enrollmentCodeFrom(String raw) {
  final text = raw.trim();
  if (text.isEmpty) return null;
  final uri = Uri.tryParse(text);
  if (uri != null && uri.scheme == 'shiftlane-chofer') {
    final code = uri.queryParameters['codigo'];
    return code == null || code.isEmpty ? null : code;
  }
  // Escrito a mano: sin espacios y solo letras, números, guion y guion bajo.
  final code = text.replaceAll(RegExp(r'\s+'), '');
  return RegExp(r'^[A-Za-z0-9_-]{20,200}$').hasMatch(code) ? code : null;
}

/// Lo que el chofer hace para entrar (lo implementa la capa de datos con la API).
abstract interface class AuthRepository {
  Future<EnrollResult> enroll({
    required String code,
    String? pin,
    DeviceCredentials? device,
  });

  Future<List<LinkedDriver>> linkedDrivers(DeviceCredentials device);

  Future<AuthTokens> login(
    DeviceCredentials device, {
    required String driverId,
    required String pin,
  });

  /// Crea un PIN nuevo después de que el despachador lo restableció.
  Future<AuthTokens> createPin(
    DeviceCredentials device, {
    required String driverId,
    required String pin,
  });

  Future<AuthTokens> refresh(String refreshToken);

  Future<void> logout(String accessToken);
}

/// Dónde se guardan las credenciales (cifradas en el celular).
abstract interface class CredentialStore {
  Future<DeviceCredentials?> readDevice();

  Future<void> writeDevice(DeviceCredentials credentials);

  /// Último chofer que entró (para restaurar la sesión al abrir la app).
  Future<({String driverId, String fullName, String refreshToken})?>
  readSession();

  Future<void> writeSession({
    required String driverId,
    required String fullName,
    required String refreshToken,
  });

  Future<void> clearSession();
}
