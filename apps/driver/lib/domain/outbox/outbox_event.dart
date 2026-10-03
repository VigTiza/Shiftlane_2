/// Tipo de las posiciones GPS en la cola (se envían en lote a `/driver/positions`).
const positionEventType = 'position';

/// Evento guardado en el celular para enviarse al servidor (aunque no haya señal).
/// Su `id` es el UUID que evita duplicados en el servidor (`/sync/batch`).
class OutboxEvent {
  const OutboxEvent({
    required this.id,
    required this.type,
    required this.sequence,
    required this.occurredAt,
    required this.data,
    this.tripId,
    this.attempts = 0,
    this.lastError,
  });

  final String id;

  /// checklist, start, stop_arrived, scan, incident, panic, gate, finish o position.
  final String type;

  /// Orden en que ocurrieron en este celular.
  final int sequence;
  final DateTime occurredAt;
  final String? tripId;
  final Map<String, Object?> data;
  final int attempts;
  final String? lastError;

  bool get isPosition => type == positionEventType;

  /// Forma en que lo recibe `/sync/batch`.
  Map<String, Object?> toSyncJson() => {
    'id': id,
    'type': type,
    'sequence': sequence,
    'occurredAt': occurredAt.toUtc().toIso8601String(),
    'tripId': ?tripId,
    'data': data,
  };
}

/// Dónde se guardan los eventos pendientes (la capa de datos lo implementa con drift).
abstract interface class OutboxRepository {
  Future<OutboxEvent> enqueue({
    required String type,
    String? tripId,
    required Map<String, Object?> data,
    DateTime? occurredAt,
  });

  /// Pendientes en el orden en que ocurrieron. [positions]: true solo posiciones GPS,
  /// false solo acciones, null todo.
  Future<List<OutboxEvent>> pending({int limit, bool? positions});

  Future<void> markSent(Iterable<String> ids);

  Future<void> markFailed(Iterable<String> ids, String error);

  Future<int> pendingCount();
}
