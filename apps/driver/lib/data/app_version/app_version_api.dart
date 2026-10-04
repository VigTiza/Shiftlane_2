import '../../core/network/api_client.dart';
import '../../domain/app_version/app_version.dart';

/// Versión mínima y última de la app (no necesita sesión).
class AppVersionApi {
  AppVersionApi(this._api);

  final ApiClient _api;

  Future<AppVersionInfo> fetch() async => AppVersionInfo.fromJson(
    await _api.get<Map<String, dynamic>>('/driver/app-version'),
  );
}
