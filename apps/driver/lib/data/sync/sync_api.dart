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

  /// Envía posiciones GPS en lote (máximo [maxPositions]) a `/driver/positions`.
  Future<PositionsReceipt> sendPositions(
    List<Map<String, Object?>> points,
  ) async {
    final response = await _api.post<Map<String, dynamic>>(
      '/driver/positions',
      body: {
        'sentAt': DateTime.now().toUtc().toIso8601String(),
        'points': points,
      },
    );
    return PositionsReceipt.fromJson(response);
  }
}

const maxPositions = 2000;
const maxSyncEvents = 1000;

/// Llegada a una parada que el servidor detectó con las posiciones (geocerca).
typedef AutoArrival = ({String tripId, String stopId});

class PositionsReceipt {
  const PositionsReceipt({
    required this.accepted,
    required this.duplicates,
    required this.rejected,
    this.autoArrivals = const [],
  });

  factory PositionsReceipt.fromJson(Map<String, dynamic> json) {
    final rejected = (json['rejected'] as Map? ?? const {}).values.fold<int>(
      0,
      (sum, n) => sum + (n as int),
    );
    return PositionsReceipt(
      accepted: json['accepted'] as int? ?? 0,
      duplicates: json['duplicates'] as int? ?? 0,
      rejected: rejected,
      autoArrivals: [
        for (final trip
            in (json['trips'] as List? ?? const [])
                .cast<Map<String, dynamic>>())
          for (final arrival
              in (trip['autoArrivals'] as List? ?? const [])
                  .cast<Map<String, dynamic>>())
            (
              tripId: trip['tripId'] as String,
              stopId: arrival['stopId'] as String,
            ),
      ],
    );
  }

  final int accepted;
  final int duplicates;
  final int rejected;
  final List<AutoArrival> autoArrivals;
}
