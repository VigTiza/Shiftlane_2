import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../domain/auth/auth_models.dart';

/// Credenciales cifradas con el almacén seguro del sistema (Android Keystore).
class SecureCredentialStore implements CredentialStore {
  SecureCredentialStore([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static const _deviceId = 'device_id';
  static const _deviceSecret = 'device_secret';
  static const _driverId = 'session_driver_id';
  static const _driverName = 'session_driver_name';
  static const _refreshToken = 'session_refresh_token';

  @override
  Future<DeviceCredentials?> readDevice() async {
    final id = await _storage.read(key: _deviceId);
    final secret = await _storage.read(key: _deviceSecret);
    if (id == null || secret == null) return null;
    return DeviceCredentials(deviceId: id, secret: secret);
  }

  @override
  Future<void> writeDevice(DeviceCredentials credentials) async {
    await _storage.write(key: _deviceId, value: credentials.deviceId);
    await _storage.write(key: _deviceSecret, value: credentials.secret);
  }

  @override
  Future<({String driverId, String fullName, String refreshToken})?>
  readSession() async {
    final driverId = await _storage.read(key: _driverId);
    final fullName = await _storage.read(key: _driverName);
    final refreshToken = await _storage.read(key: _refreshToken);
    if (driverId == null || fullName == null || refreshToken == null) {
      return null;
    }
    return (driverId: driverId, fullName: fullName, refreshToken: refreshToken);
  }

  @override
  Future<void> writeSession({
    required String driverId,
    required String fullName,
    required String refreshToken,
  }) async {
    await _storage.write(key: _driverId, value: driverId);
    await _storage.write(key: _driverName, value: fullName);
    await _storage.write(key: _refreshToken, value: refreshToken);
  }

  @override
  Future<void> clearSession() async {
    await _storage.delete(key: _driverId);
    await _storage.delete(key: _driverName);
    await _storage.delete(key: _refreshToken);
  }
}
