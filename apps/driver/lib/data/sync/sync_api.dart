import '../../core/network/api_client.dart';
import '../../domain/trips/trip_models.dart';

/// Resultado del servidor para un evento del lote.
typedef SyncEventResult = ({String id, ActionResult result});

SyncStatus _status(String value) => switch (value) {
  'applied' => SyncStatus.applied,
  'duplicate' => SyncStatus.duplicate,
  'rejected' => SyncStatus.rejected,
  _ => SyncStatus.retry,
};

/// Envía lotes de eventos a `/sync/batch` (los que se hicieron con o sin señal).
class SyncApi {
  SyncApi(this._api);

  final ApiClient _api;

  Future<List<SyncEventResult>> send(List<Map<String, Object?>> events) async {
    final response = await _api.post<Map<String, dynamic>>(
      '/sync/batch',
      body: {
        'sentAt': DateTime.now().toUtc().toIso8601String(),
        'events': events,
      },
    );
    return (response['results'] as List<dynamic>)
        .cast<Map<String, dynamic>>()
        .map(
          (r) => (
            id: r['id'] as String,
            result: ActionResult(
              _status(r['status'] as String),
              message: r['message'] as String?,
              result: r['result'] is Map<String, dynamic>
                  ? r['result'] as Map<String, dynamic>
                  : null,
            ),
          ),
        )
        .toList();
  }
}
