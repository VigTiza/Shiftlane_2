import '../../domain/outbox/outbox_event.dart';
import '../../domain/tracking/gps_fix.dart';

/// Registra lo que hace el chofer para enviarlo cuando haya señal. Todo pasa primero por
/// aquí: así nada se pierde si el celular se queda sin conexión o se reinicia.
class OutboxService {
  OutboxService(this._repository);

  final OutboxRepository _repository;

  static const Set<String> eventTypes = {
    'checklist',
    'start',
    'stop_arrived',
    'scan',
    'incident',
    'panic',
    'gate',
    'finish',
  };

  Future<OutboxEvent> record(
    String type, {
    String? tripId,
    Map<String, Object?> data = const {},
    DateTime? occurredAt,
  }) {
    if (!eventTypes.contains(type)) {
      throw ArgumentError.value(type, 'type', 'Tipo de evento desconocido');
    }
    if (type != 'panic' && tripId == null) {
      throw ArgumentError('El evento $type necesita el viaje');
    }
    return _repository.enqueue(
      type: type,
      tripId: tripId,
      data: data,
      occurredAt: occurredAt,
    );
  }

  /// Posición GPS del viaje en curso (sale en lote por `/driver/positions`).
  Future<OutboxEvent> recordPosition(
    String tripId,
    GpsFix fix, {
    int? battery,
  }) => _repository.enqueue(
    type: positionEventType,
    tripId: tripId,
    data: fix.toPointJson(tripId, battery: battery),
    occurredAt: fix.recordedAt,
  );

  Future<int> pendingCount() => _repository.pendingCount();
}
