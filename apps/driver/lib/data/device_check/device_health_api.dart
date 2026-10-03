import '../../core/network/api_client.dart';
import '../../domain/device_check/device_check.dart';

typedef ServerIssue = ({String code, String severity, String message});

/// Envía la revisión del celular a `/driver/health`; el servidor responde lo que solo él
/// puede saber (hora desfasada y versión mínima de la app).
class DeviceHealthApi {
  DeviceHealthApi(this._api);

  final ApiClient _api;

  Future<List<ServerIssue>> send(
    DeviceReadings readings, {
    DateTime? now,
  }) async {
    final at = now ?? DateTime.now();
    final response = await _api.post<Map<String, dynamic>>(
      '/driver/health',
      body: {
        'sentAt': at.toUtc().toIso8601String(),
        'reports': [readings.toHealthReport(at)],
      },
    );
    return (response['issues'] as List<dynamic>? ?? [])
        .cast<Map<String, dynamic>>()
        .map(
          (i) => (
            code: i['code'] as String,
            severity: i['severity'] as String,
            message: i['message'] as String,
          ),
        )
        .toList();
  }
}
