import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shiftlane_driver/application/auth/auth_controller.dart';
import 'package:shiftlane_driver/application/auth/auth_providers.dart';
import 'package:shiftlane_driver/application/outbox/outbox_service.dart';
import 'package:shiftlane_driver/application/providers.dart';
import 'package:shiftlane_driver/application/sync/sync_service.dart';
import 'package:shiftlane_driver/core/config/environment.dart';
import 'package:shiftlane_driver/core/errors/app_failure.dart';
import 'package:shiftlane_driver/core/network/api_client.dart';
import 'package:shiftlane_driver/data/local/app_database.dart';
import 'package:shiftlane_driver/data/outbox/drift_outbox_repository.dart';
import 'package:shiftlane_driver/data/trips/trip_snapshot_store.dart';
import 'package:shiftlane_driver/domain/auth/auth_models.dart';
import 'package:shiftlane_driver/domain/outbox/outbox_event.dart';
import 'package:shiftlane_driver/domain/tracking/gps_fix.dart';
import 'package:shiftlane_driver/domain/trips/pending_overlay.dart';
import 'package:shiftlane_driver/domain/trips/trip_models.dart';

import '../support/fakes.dart';

InMemoryCredentialStore _signedIn() => InMemoryCredentialStore()
  ..device = const DeviceCredentials(
    deviceId: 'device-1',
    secret: 'secreto-del-celular-123456',
  )
  ..session = (driverId: 'd1', fullName: 'Juan Pérez', refreshToken: 'r');

void _tallScreen(WidgetTester tester) {
  tester.view.physicalSize = const Size(1080, 2600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

GpsFix _fix(int second, {double accuracy = 8}) => GpsFix(
  lat: 31.74,
  lng: -106.46,
  recordedAt: DateTime.utc(2026, 10, 5, 11, 0, second),
  accuracyM: accuracy,
);

OutboxEvent _event(String type, {Map<String, Object?> data = const {}}) =>
    OutboxEvent(
      id: '$type-${data.hashCode}',
      type: type,
      sequence: 1,
      occurredAt: DateTime.utc(2026, 10, 5),
      tripId: 'trip-1',
      data: data,
    );

/// Respuestas HTTP armadas a mano para probar el cliente sin servidor.
class _ScriptedAdapter implements HttpClientAdapter {
  _ScriptedAdapter(this.respond);

  final ResponseBody Function(RequestOptions options) respond;
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    return respond(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _json(int status, Object body) => ResponseBody.fromString(
  jsonEncode(body),
  status,
  headers: {
    Headers.contentTypeHeader: [Headers.jsonContentType],
  },
);

final _expired = {
  'error': {'code': 'UNAUTHORIZED', 'message': 'Token vencido'},
};

void main() {
  group('posiciones', () {
    test('se guarda una cada 10 s y solo si es precisa', () {
      expect(shouldRecord(null, _fix(0)), isTrue);
      expect(shouldRecord(_fix(0), _fix(5)), isFalse);
      expect(shouldRecord(_fix(0), _fix(10)), isTrue);
      expect(shouldRecord(null, _fix(0, accuracy: 250)), isFalse);
    });

    test('el punto respeta los límites del servidor', () {
      final point = GpsFix(
        lat: 31.74,
        lng: -106.46,
        recordedAt: DateTime.utc(2026, 10, 5, 11),
        speedKmh: 420,
        heading: 12,
      ).toPointJson('trip-1', battery: 64);
      expect(point, {
        'tripId': 'trip-1',
        'recordedAt': '2026-10-05T11:00:00.000Z',
        'lat': 31.74,
        'lng': -106.46,
        'speedKmh': 300,
        'heading': 12,
        'battery': 64,
      });
    });
  });

  group('copia local de los viajes', () {
    test('ida y vuelta a JSON sin perder datos', () {
      final trip = DriverTrip.fromJson(
        tripJson(status: 'in_progress', onboard: 3),
      ).copyWith(stopsArrived: {'stop-0'});
      final copy = DriverTrip.fromJson(
        (jsonDecode(jsonEncode(trip.toJson())) as Map).cast<String, dynamic>(),
      );
      expect(copy.toJson(), trip.toJson());
      expect(copy.nextStop?.name, 'Tecnológico');
    });

    test('lo pendiente en la cola se ve en la lista del servidor', () {
      final trips = [DriverTrip.fromJson(tripJson())];
      final shown = applyPendingEvents(trips, [
        _event(
          'checklist',
          data: {
            'items': [
              {'key': 'tires', 'ok': true},
            ],
          },
        ),
        _event('start'),
        _event('stop_arrived', data: {'stopId': 'stop-0'}),
        _event('scan', data: {'employeeNumber': 'A-1'}),
        _event('scan', data: {'employeeNumber': 'A-2'}),
      ]).single;
      expect(shown.status, TripStatus.inProgress);
      expect(shown.checklistAllowsStart, isTrue);
      expect(shown.stopsArrived, {'stop-0'});
      expect(shown.onboard, 2);
      expect(
        applyPendingEvents([shown], [_event('finish')]).single.status,
        TripStatus.completed,
      );
    });

    test('actualizar la app conserva la cola y agrega la copia local', () async {
      // Base de la versión 1 (solo la cola) con un evento pendiente.
      final db = AppDatabase(
        NativeDatabase.memory(
          setup: (raw) => raw
            ..execute(
              'CREATE TABLE outbox_events (id TEXT NOT NULL PRIMARY KEY, '
              'type TEXT NOT NULL, sequence INTEGER NOT NULL, '
              'occurred_at INTEGER NOT NULL, trip_id TEXT, payload TEXT NOT NULL, '
              'attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, sent_at INTEGER)',
            )
            ..execute(
              'INSERT INTO outbox_events (id, type, sequence, occurred_at, trip_id, '
              "payload) VALUES ('e1', 'start', 1, 1791198000, 'trip-1', '{}')",
            )
            ..execute('PRAGMA user_version = 1'),
        ),
      );
      addTearDown(db.close);
      expect(await DriftOutboxRepository(db).pendingCount(), 1);
      final store = TripSnapshotStore(db);
      await store.save('d1', [DriverTrip.fromJson(tripJson())]);
      expect(await store.load('d1'), hasLength(1));
    });

    test('la copia guardada vence a las 24 horas', () async {
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      var now = DateTime(2026, 10, 5, 6);
      final store = TripSnapshotStore(db, clock: () => now);
      expect(await store.load('d1'), isNull);
      await store.save('d1', [DriverTrip.fromJson(tripJson())]);
      expect((await store.load('d1'))!.single.id, 'trip-1');
      expect(await store.load('otro-chofer'), isNull);
      now = now.add(const Duration(hours: 25));
      expect(await store.load('d1'), isNull);
    });
  });

  group('cola de sincronización', () {
    late AppDatabase db;
    late DriftOutboxRepository outbox;
    late OutboxService service;

    setUp(() {
      db = AppDatabase(NativeDatabase.memory());
      outbox = DriftOutboxRepository(db);
      service = OutboxService(outbox);
    });
    tearDown(() => db.close());

    test('primero las acciones y luego las posiciones, una sola vez', () async {
      final api = FakeSyncApi();
      final sync = SyncService(outbox: outbox, api: api);
      await service.record('start', tripId: 'trip-1');
      await service.recordPosition('trip-1', _fix(0));
      await service.record(
        'scan',
        tripId: 'trip-1',
        data: {'employeeNumber': 'A-1'},
      );
      final report = await sync.flush();
      expect(api.calls, ['batch', 'positions']);
      expect(api.types, ['start', 'scan']);
      expect(api.positions.single['recordedAt'], '2026-10-05T11:00:00.000Z');
      expect(report.pending, 0);
      expect(report.offline, isFalse);
      await sync.flush();
      expect(api.calls, ['batch', 'positions']);
    });

    test('sin conexión no se pierde nada y al reconectar sale todo', () async {
      final api = FakeSyncApi()..offline = true;
      final sync = SyncService(outbox: outbox, api: api);
      final start = await service.record('start', tripId: 'trip-1');
      await service.recordPosition('trip-1', _fix(0));
      await service.recordPosition('trip-1', _fix(15));
      final offline = await sync.flush();
      expect(offline.offline, isTrue);
      expect(offline.pending, 3);
      expect(offline.results[start.id]?.status, SyncStatus.queued);
      expect((await outbox.pending()).first.attempts, 1);

      api.offline = false;
      final online = await sync.flush();
      expect(online.pending, 0);
      expect(api.received.single['id'], start.id);
      expect(api.positions, hasLength(2));
      expect(api.positionBatches, 1);
    });

    test('llegadas a parada detectadas por el servidor', () async {
      final api = FakeSyncApi()
        ..autoArrivals = [(tripId: 'trip-1', stopId: 'stop-0')];
      final sync = SyncService(outbox: outbox, api: api);
      await service.recordPosition('trip-1', _fix(0));
      final report = await sync.flush();
      expect(report.autoArrivals, [(tripId: 'trip-1', stopId: 'stop-0')]);
    });

    test('posiciones que el servidor nunca acepta no atoran la cola', () async {
      final api = FakeSyncApi()
        ..positionsFailure = const ValidationFailure('Datos inválidos');
      final sync = SyncService(outbox: outbox, api: api);
      await service.recordPosition('trip-1', _fix(0));
      for (var i = 1; i < SyncService.maxPositionAttempts; i++) {
        expect((await sync.flush()).pending, 1);
      }
      expect((await sync.flush()).pending, 0);
    });
  });

  group('sesión vencida', () {
    test('renueva el token y repite la petición', () async {
      var token = 'viejo';
      var refreshes = 0;
      final adapter = _ScriptedAdapter(
        (o) => o.headers['authorization'] == 'Bearer nuevo'
            ? _json(200, {'ok': true})
            : _json(401, _expired),
      );
      final api = ApiClient.create(
        AppConfig.fromValues(environment: 'dev'),
        readToken: () async => token,
        refreshToken: () async {
          refreshes += 1;
          return token = 'nuevo';
        },
        adapter: adapter,
      );
      expect(await api.get<Map<String, dynamic>>('/driver/trips'), {
        'ok': true,
      });
      expect(refreshes, 1);
      expect(adapter.requests.map((r) => r.headers['authorization']), [
        'Bearer viejo',
        'Bearer nuevo',
      ]);
    });

    test(
      'sin renovación queda el 401; las rutas de acceso no se repiten',
      () async {
        var refreshes = 0;
        final adapter = _ScriptedAdapter((_) => _json(401, _expired));
        final api = ApiClient.create(
          AppConfig.fromValues(environment: 'dev'),
          readToken: () async => 'viejo',
          refreshToken: () async {
            refreshes += 1;
            return null;
          },
          adapter: adapter,
        );
        await expectLater(
          api.get<Object?>('/driver/trips'),
          throwsA(isA<UnauthorizedFailure>()),
        );
        await expectLater(
          api.post<Object?>('/auth/refresh'),
          throwsA(isA<UnauthorizedFailure>()),
        );
        expect(refreshes, 1);
        expect(adapter.requests, hasLength(2));
      },
    );

    ProviderContainer authContainer(
      InMemoryCredentialStore store,
      FakeAuthRepository repository,
    ) {
      final container = ProviderContainer(
        overrides: [
          credentialStoreProvider.overrideWithValue(store),
          authRepositoryProvider.overrideWithValue(repository),
        ],
      );
      addTearDown(container.dispose);
      return container;
    }

    test('varias peticiones vencidas a la vez: una sola renovación', () async {
      final repository = FakeAuthRepository();
      final container = authContainer(_signedIn(), repository);
      final auth = container.read(authControllerProvider.notifier);
      final tokens = await Future.wait([
        auth.refreshAccessToken(),
        auth.refreshAccessToken(),
      ]);
      expect(tokens, ['access-renovado', 'access-renovado']);
      expect(repository.calls, ['refresh:r']);
      expect(container.read(accessTokenProvider), 'access-renovado');
      expect(container.read(authControllerProvider), isA<AuthSignedIn>());
    });

    test('sin señal sigue adentro; sesión rechazada pide el PIN', () async {
      final store = _signedIn();
      final repository = FakeAuthRepository()..offline = true;
      final container = authContainer(store, repository);
      final auth = container.read(authControllerProvider.notifier);
      expect(await auth.refreshAccessToken(), isNull);
      expect(store.session, isNotNull);

      repository
        ..offline = false
        ..refreshRejected = true;
      expect(await auth.refreshAccessToken(), isNull);
      expect(store.session, isNull);
      expect(container.read(authControllerProvider), isA<AuthNeedsDriver>());
    });
  });

  testWidgets('el GPS se enciende solo durante el viaje', (tester) async {
    _tallScreen(tester);
    final gps = FakeLocationTracker();
    final sync = FakeSyncApi();
    await pumpApp(
      tester,
      store: _signedIn(),
      repository: FakeAuthRepository(),
      trips: FakeTripRepository(
        trips: [tripJson(checklistDone: true, checklistPassed: true)],
      ),
      sync: sync,
      location: gps,
    );
    expect(gps.listening, isFalse);

    await tester.tap(find.text('Iniciar viaje'));
    await tester.pumpAndSettle();
    expect(gps.listening, isTrue);
    gps.moveTo(31.80, -106.46);
    gps.moveTo(31.801, -106.46, after: const Duration(seconds: 5));
    gps.moveTo(31.802, -106.46, after: const Duration(seconds: 6));
    gps.moveTo(31.803, -106.46, accuracy: 250);
    await tester.pumpAndSettle();
    expect(sync.positions.map((p) => p['lat']), [31.80, 31.802]);

    await tester.tap(find.byKey(const Key('trip-arrival')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('finish-without-gate')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('finish-confirm')));
    await tester.pumpAndSettle();
    expect(gps.listening, isFalse);
  });

  testWidgets('sin señal: aviso, todo se guarda y al volver la red se envía', (
    tester,
  ) async {
    _tallScreen(tester);
    final net = FakeConnectivity()..online = false;
    final sync = FakeSyncApi();
    final gps = FakeLocationTracker();
    final container = await pumpApp(
      tester,
      store: _signedIn(),
      repository: FakeAuthRepository(),
      trips: FakeTripRepository(trips: [tripJson(status: 'in_progress')]),
      sync: sync,
      location: gps,
      connectivity: net,
    );
    expect(find.text('Sin señal — tus datos están guardados'), findsOneWidget);
    await tester.tap(find.text('R-01 · Riberas'));
    await tester.pumpAndSettle();
    gps.moveTo(31.80, -106.46);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('arrive-stop')));
    await tester.pumpAndSettle();
    // El chofer sigue: la pantalla avanza aunque nada haya salido.
    expect(find.text('Tecnológico · 05:15'), findsOneWidget);
    expect(find.text('2 registros por enviar'), findsOneWidget);
    expect(sync.attempts, 0);

    net.set(true);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('offline-banner')), findsNothing);
    expect(sync.calls, ['batch', 'positions']);
    expect(sync.types, ['stop_arrived']);
    expect(sync.positions, hasLength(1));
    expect(await container.read(outboxRepositoryProvider).pendingCount(), 0);
  });

  testWidgets(
    'si el servidor no responde se reintenta cada vez más espaciado',
    (tester) async {
      _tallScreen(tester);
      final sync = FakeSyncApi()..offline = true;
      await pumpApp(
        tester,
        store: _signedIn(),
        repository: FakeAuthRepository(),
        trips: FakeTripRepository(trips: [tripJson(status: 'in_progress')]),
        sync: sync,
      );
      await tester.tap(find.text('R-01 · Riberas'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('arrive-stop')));
      await tester.pumpAndSettle();
      expect(sync.attempts, 1);
      expect(find.byKey(const Key('offline-banner')), findsOneWidget);

      await tester.pump(const Duration(seconds: 6)); // reintento a los 5 s
      expect(sync.attempts, 2);
      await tester.pump(const Duration(seconds: 6)); // el siguiente, a los 10 s
      expect(sync.attempts, 2);

      sync.offline = false;
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      expect(sync.attempts, 3);
      expect(sync.types, ['stop_arrived']);
      expect(find.byKey(const Key('offline-banner')), findsNothing);
    },
  );

  testWidgets('las llegadas que detecta el servidor avanzan la parada', (
    tester,
  ) async {
    _tallScreen(tester);
    final gps = FakeLocationTracker();
    final sync = FakeSyncApi()
      ..autoArrivals = [(tripId: 'trip-1', stopId: 'stop-0')];
    await pumpApp(
      tester,
      store: _signedIn(),
      repository: FakeAuthRepository(),
      trips: FakeTripRepository(trips: [tripJson(status: 'in_progress')]),
      sync: sync,
      location: gps,
    );
    await tester.tap(find.text('R-01 · Riberas'));
    await tester.pumpAndSettle();
    expect(find.text('Plaza · 05:00'), findsOneWidget);
    gps.moveTo(31.7401, -106.46);
    await tester.pumpAndSettle();
    expect(find.text('Tecnológico · 05:15'), findsOneWidget);
    expect(sync.received, isEmpty);
  });

  testWidgets('reinicio del celular a mitad del viaje sin señal', (
    tester,
  ) async {
    _tallScreen(tester);
    final dir = Directory.systemTemp.createTempSync('shiftlane-');
    addTearDown(() {
      try {
        dir.deleteSync(recursive: true);
      } on FileSystemException {
        // Windows puede tardar en soltar el archivo; es temporal.
      }
    });
    final file = File('${dir.path}/shiftlane.sqlite');
    final store = _signedIn();
    final trips = FakeTripRepository(trips: [tripJson(status: 'in_progress')]);
    final sync = FakeSyncApi();

    // Primer arranque con señal; a mitad del viaje se pierde.
    final firstDb = AppDatabase(NativeDatabase(file));
    addTearDown(firstDb.close);
    final firstGps = FakeLocationTracker();
    final firstNet = FakeConnectivity();
    await pumpApp(
      tester,
      store: store,
      repository: FakeAuthRepository(),
      trips: trips,
      sync: sync,
      location: firstGps,
      connectivity: firstNet,
      database: firstDb,
    );
    firstNet.set(false);
    sync.offline = true;
    trips.offline = true;
    await tester.tap(find.text('R-01 · Riberas'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('arrive-stop')));
    await tester.pumpAndSettle();
    firstGps.moveTo(31.735, -106.455);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('trip-scan')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('scan-manual')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('employee-number-field')),
      'A-123',
    );
    await tester.tap(find.text('Registrar'));
    await tester.pumpAndSettle();
    expect(find.text('Sin señal: el escaneo quedó guardado.'), findsOneWidget);
    expect(find.text('A bordo: 1'), findsOneWidget);
    expect(sync.attempts, 0);

    // Se apaga el celular.
    await tester.pumpWidget(const SizedBox());
    await firstDb.close();

    // Segundo arranque, todavía sin señal: el viaje sigue donde quedó.
    final secondDb = AppDatabase(NativeDatabase(file));
    addTearDown(secondDb.close);
    final secondGps = FakeLocationTracker();
    final secondNet = FakeConnectivity()..online = false;
    final container = await pumpApp(
      tester,
      store: store,
      repository: FakeAuthRepository()..offline = true,
      trips: trips,
      sync: sync,
      location: secondGps,
      connectivity: secondNet,
      database: secondDb,
    );
    expect(find.text('En curso'), findsOneWidget);
    expect(find.text('3 registros por enviar'), findsOneWidget);
    expect(secondGps.listening, isTrue);
    await tester.tap(find.text('R-01 · Riberas'));
    await tester.pumpAndSettle();
    expect(find.text('Tecnológico · 05:15'), findsOneWidget);
    expect(find.text('1 / 19'), findsOneWidget);

    // Vuelve la señal: todo sale una sola vez y en orden.
    sync.offline = false;
    trips.offline = false;
    secondNet.set(true);
    await tester.pumpAndSettle();
    expect(sync.types, ['stop_arrived', 'scan']);
    expect(sync.positions.single['lat'], 31.735);
    expect(sync.received.map((e) => e['id']).toSet(), hasLength(2));
    expect(find.byKey(const Key('offline-banner')), findsNothing);
    expect(await container.read(outboxRepositoryProvider).pendingCount(), 0);
  });
}
