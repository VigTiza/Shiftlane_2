import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shiftlane_driver/application/outbox/outbox_service.dart';
import 'package:shiftlane_driver/data/local/app_database.dart';
import 'package:shiftlane_driver/data/outbox/drift_outbox_repository.dart';

void main() {
  late AppDatabase db;
  late DriftOutboxRepository repository;
  late OutboxService service;

  setUp(() {
    db = AppDatabase(NativeDatabase.memory());
    repository = DriftOutboxRepository(db);
    service = OutboxService(repository);
  });

  tearDown(() => db.close());

  test('guarda los eventos en orden con un UUID cada uno', () async {
    final first = await service.record(
      'start',
      tripId: 'trip-1',
      data: {'lat': 31.7},
    );
    final second = await service.record(
      'scan',
      tripId: 'trip-1',
      data: {'employeeNumber': 'A-1'},
    );
    final pending = await repository.pending();
    expect(pending.map((e) => e.type), ['start', 'scan']);
    expect(pending.map((e) => e.sequence), [1, 2]);
    expect(first.id, isNot(second.id));
    expect(first.id, hasLength(36));
    expect(pending[1].toSyncJson(), {
      'id': second.id,
      'type': 'scan',
      'sequence': 2,
      'occurredAt': second.occurredAt.toUtc().toIso8601String(),
      'tripId': 'trip-1',
      'data': {'employeeNumber': 'A-1'},
    });
  });

  test('marca enviados y fallidos', () async {
    final a = await service.record('start', tripId: 't');
    final b = await service.record('finish', tripId: 't');
    await repository.markFailed([b.id], 'Sin conexión');
    await repository.markSent([a.id]);
    final pending = await repository.pending();
    expect(pending.map((e) => e.id), [b.id]);
    expect(pending.single.attempts, 1);
    expect(pending.single.lastError, 'Sin conexión');
    expect(await service.pendingCount(), 1);
  });

  test('el pánico no necesita viaje; los demás sí', () async {
    final panic = await service.record('panic', data: {'lat': 31.7});
    expect(panic.tripId, isNull);
    expect(panic.toSyncJson().containsKey('tripId'), isFalse);
    expect(() => service.record('scan'), throwsArgumentError);
    expect(() => service.record('teleport', tripId: 't'), throwsArgumentError);
  });
}
