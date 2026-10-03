import '../../core/network/api_client.dart';
import '../../domain/auth/auth_models.dart';

AuthTokens _tokens(Map<String, dynamic> json) => AuthTokens(
  accessToken: json['accessToken'] as String,
  refreshToken: json['refreshToken'] as String,
);

/// Acceso del chofer con la API de Shiftlane (/auth/driver/...).
class ApiAuthRepository implements AuthRepository {
  ApiAuthRepository(this._api, {required this.deviceInfo});

  final ApiClient _api;

  /// Plataforma, modelo y versión que se registran con el celular.
  final Map<String, Object?> deviceInfo;

  @override
  Future<EnrollResult> enroll({
    required String code,
    String? pin,
    DeviceCredentials? device,
  }) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/auth/driver/enroll',
      body: {
        'code': code,
        'pin': ?pin,
        'device': {...deviceInfo, ...?device?.toJson()},
      },
    );
    final driver = json['driver'] as Map<String, dynamic>;
    final deviceJson = json['device'] as Map<String, dynamic>;
    return EnrollResult(
      tokens: _tokens(json),
      driverId: driver['id'] as String,
      fullName: driver['fullName'] as String,
      deviceId: deviceJson['id'] as String,
      newDeviceSecret: deviceJson['secret'] as String?,
    );
  }

  @override
  Future<List<LinkedDriver>> linkedDrivers(DeviceCredentials device) async {
    final list = await _api.post<List<dynamic>>(
      '/auth/driver/device-drivers',
      body: device.toJson(),
    );
    return list
        .cast<Map<String, dynamic>>()
        .map(
          (d) => LinkedDriver(
            id: d['id'] as String,
            fullName: d['fullName'] as String,
            pinSet: d['pinSet'] as bool,
          ),
        )
        .toList();
  }

  @override
  Future<AuthTokens> login(
    DeviceCredentials device, {
    required String driverId,
    required String pin,
  }) async => _tokens(
    await _api.post<Map<String, dynamic>>(
      '/auth/driver/login',
      body: {...device.toJson(), 'driverId': driverId, 'pin': pin},
    ),
  );

  @override
  Future<AuthTokens> createPin(
    DeviceCredentials device, {
    required String driverId,
    required String pin,
  }) async => _tokens(
    await _api.post<Map<String, dynamic>>(
      '/auth/driver/pin',
      body: {...device.toJson(), 'driverId': driverId, 'pin': pin},
    ),
  );

  @override
  Future<AuthTokens> refresh(String refreshToken) async => _tokens(
    await _api.post<Map<String, dynamic>>(
      '/auth/refresh',
      body: {'refreshToken': refreshToken},
    ),
  );

  @override
  Future<void> logout(String accessToken) async {
    await _api.post<Object?>('/auth/logout');
  }
}
