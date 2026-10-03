import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:uuid/uuid.dart';

import '../../domain/outbox/outbox_event.dart';
import '../local/app_database.dart';

/// Cola local en SQLite: sobrevive a que se cierre la app o se reinicie el celular.
class DriftOutboxRepository implements OutboxRepository {
  DriftOutboxRepository(this._db, {Uuid? uuid, DateTime Function()? clock})
    : _uuid = uuid ?? const Uuid(),
      _clock = clock ?? DateTime.now;

  final AppDatabase _db;
  final Uuid _uuid;
  final DateTime Function() _clock;

  OutboxEvent _toDomain(OutboxEventRow row) => OutboxEvent(
    id: row.id,
    type: row.type,
    sequence: row.sequence,
    occurredAt: row.occurredAt,
    tripId: row.tripId,
    data: (jsonDecode(row.payload) as Map).cast<String, Object?>(),
    attempts: row.attempts,
    lastError: row.lastError,
  );

  @override
  Future<OutboxEvent> enqueue({
    required String type,
    String? tripId,
    required Map<String, Object?> data,
    DateTime? occurredAt,
  }) {
    return _db.transaction(() async {
      final last =
          await (_db.selectOnly(_db.outboxEvents)
                ..addColumns([_db.outboxEvents.sequence.max()]))
              .map((row) => row.read(_db.outboxEvents.sequence.max()))
              .getSingle();
      final row = OutboxEventsCompanion.insert(
        id: _uuid.v4(),
        type: type,
        sequence: (last ?? 0) + 1,
        occurredAt: occurredAt ?? _clock(),
        tripId: Value(tripId),
        payload: jsonEncode(data),
      );
      await _db.into(_db.outboxEvents).insert(row);
      final saved = await (_db.select(
        _db.outboxEvents,
      )..where((e) => e.id.equals(row.id.value))).getSingle();
      return _toDomain(saved);
    });
  }

  @override
  Future<List<OutboxEvent>> pending({int limit = 500}) async {
    final rows =
        await (_db.select(_db.outboxEvents)
              ..where((e) => e.sentAt.isNull())
              ..orderBy([(e) => OrderingTerm.asc(e.sequence)])
              ..limit(limit))
            .get();
    return rows.map(_toDomain).toList();
  }

  @override
  Future<void> markSent(Iterable<String> ids) async {
    await (_db.update(_db.outboxEvents)..where((e) => e.id.isIn(ids))).write(
      OutboxEventsCompanion(sentAt: Value(_clock())),
    );
  }

  @override
  Future<void> markFailed(Iterable<String> ids, String error) async {
    await _db.customUpdate(
      'UPDATE outbox_events SET attempts = attempts + 1, last_error = ? '
      'WHERE id IN (${List.filled(ids.length, '?').join(', ')})',
      variables: [Variable.withString(error), ...ids.map(Variable.withString)],
      updates: {_db.outboxEvents},
    );
  }

  @override
  Future<int> pendingCount() async {
    final count = _db.outboxEvents.id.count();
    return (_db.selectOnly(_db.outboxEvents)
          ..addColumns([count])
          ..where(_db.outboxEvents.sentAt.isNull()))
        .map((row) => row.read(count) ?? 0)
        .getSingle();
  }
}
