import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shiftlane_driver/application/providers.dart';
import 'package:shiftlane_driver/application/sync/sync_service.dart';
import 'package:shiftlane_driver/data/local/app_database.dart';
import 'package:shiftlane_driver/data/outbox/drift_outbox_repository.dart';
import 'package:shiftlane_driver/data/realtime/socket_realtime_client.dart';
import 'package:shiftlane_driver/domain/auth/auth_models.dart';
import 'package:shiftlane_driver/domain/map/tiles.dart';
import 'package:shiftlane_driver/domain/trips/stop_notice.dart';
import 'package:shiftlane_driver/domain/trips/trip_models.dart';

import '../support/fakes.dart';

InMemoryCredentialStore _signedIn() => InMemoryCredentialStore()
  ..device = const DeviceCredentials(
    deviceId: 'device-1',
    secret: 'secreto-del-celular-123456',
  )
  ..session = (driverId: 'd1', fullName: 'Juan Pérez', refreshToken: 'r');

/// Pantalla alta para ver todo sin desplazarse.
void _tallScreen(WidgetTester tester) {
  tester.view.physicalSize = const Size(1080, 2600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

void main() {
  tearDown(() => fakeScannedCode = qrPayload);

  group('modelos del viaje', () {
    test('lee la respuesta de /driver/trips', () {
      final trip = DriverTrip.fromJson(tripJson());
      expect(trip.title, 'R-01 · Riberas');
      expect(trip.status, TripStatus.scheduled);
      expect(trip.stops.map((s) => s.time), ['05:00', '05:15', '05:30']);
      expect(trip.nextStop?.name, 'Plaza');
      expect(trip.checklistAllowsStart, isFalse);
      final arrived = trip.copyWith(stopsArrived: {'stop-0'});
      expect(arrived.nextStop?.name, 'Tecnológico');
      expect(DriverTrip.fromJson(tripJson(onboard: 20)).overCapacity, isTrue);
      expect(
        DriverTrip.fromJson(
          tripJson(checklistDone: true, exceptionAuthorized: true),
        ).checklistAllowsStart,
        isTrue,
      );
    });

    test('calcula los mosaicos de una ruta sin pasar del límite', () {
      expect(tileFor(31.7445, -106.4605, 12), (z: 12, x: 836, y: 1666));
      final tiles = tilesForRoute(
        [(lat: 31.74, lng: -106.46), (lat: 31.69, lng: -106.37)],
        zooms: [12, 13],
      );
      expect(tiles.first.z, 12);
      expect(tiles.toSet(), hasLength(tiles.length));
      expect(
        tilesForRoute([(lat: 31.74, lng: -106.46)], maxTiles: 5),
        hasLength(5),
      );
      expect(
        tileUrl('https://t/{z}/{x}/{y}.png', (z: 1, x: 2, y: 3)),
        'https://t/1/2/3.png',
      );
    });
  });

  group('aviso de parada', () {
    final trip = DriverTrip.fromJson(tripJson(status: 'in_progress'));

    test('mide distancias en metros', () {
      // Un grado de latitud son ~111 km.
      expect(
        distanceMeters((lat: 31, lng: -106), (lat: 32, lng: -106)),
        closeTo(111195, 50),
      );
    });

    test('avisa al acercarse y al llegar a la siguiente parada', () {
      expect(stopNoticeFor(trip, null), isNull);
      expect(stopNoticeFor(trip, (lat: 31.80, lng: -106.46)), isNull);
      final near = stopNoticeFor(trip, (lat: 31.7436, lng: -106.46))!;
      expect(near.stop.name, 'Plaza');
      expect(near.atStop, isFalse);
      expect(near.text, 'Plaza a 400 m');
      final there = stopNoticeFor(trip, (lat: 31.7403, lng: -106.46))!;
      expect(there.atStop, isTrue);
      expect(there.text, 'Llegaste a Plaza. Marca la parada.');
      // Ya visitada: el aviso pasa a la siguiente.
      expect(
        stopNoticeFor(trip.copyWith(stopsArrived: {'stop-0'}), (
          lat: 31.7403,
          lng: -106.46,
        )),
        isNull,
      );
    });
  });

  group('sincronización de la cola', () {
    late AppDatabase db;
    late DriftOutboxRepository outbox;

    setUp(() {
      db = AppDatabase(NativeDatabase.memory());
      outbox = DriftOutboxRepository(db);
    });
    tearDown(() => db.close());

    test(
      'lo aplicado o rechazado sale de la cola; lo de reintentar se queda',
      () async {
        final api = FakeSyncApi()
          ..responses['scan'] = const ActionResult(
            SyncStatus.retry,
            message: 'Todavía no se recibe el inicio del viaje.',
          )
          ..responses['gate'] = const ActionResult(
            SyncStatus.rejected,
            message: 'Este QR es de otra planta.',
          );
        final sync = SyncService(outbox: outbox, api: api);
        await outbox.enqueue(type: 'start', tripId: 't', data: {});
        final scan = await outbox.enqueue(type: 'scan', tripId: 't', data: {});
        final gate = await outbox.enqueue(type: 'gate', tripId: 't', data: {});
        final results = await sync.flush();
        expect(results[gate.id]?.message, 'Este QR es de otra planta.');
        expect((await outbox.pending()).map((e) => e.id), [scan.id]);
        expect(api.types, ['start', 'scan', 'gate']);
      },
    );

    test('sin señal todo queda guardado para después', () async {
      final api = FakeSyncApi()..offline = true;
      final sync = SyncService(outbox: outbox, api: api);
      final event = await outbox.enqueue(type: 'start', tripId: 't', data: {});
      final results = await sync.flush();
      expect(results[event.id]?.status, SyncStatus.queued);
      expect(await outbox.pendingCount(), 1);
      api.offline = false;
      await sync.flush();
      expect(await outbox.pendingCount(), 0);
    });
  });

  testWidgets(
    'inicio: checklist con foto obligatoria, inicia y abre el viaje',
    (tester) async {
      _tallScreen(tester);
      final trips = FakeTripRepository(trips: [tripJson()]);
      final sync = FakeSyncApi();
      await pumpApp(
        tester,
        store: _signedIn(),
        repository: FakeAuthRepository(),
        trips: trips,
        sync: sync,
      );
      expect(find.text('R-01 · Riberas'), findsOneWidget);
      expect(find.text('Programado'), findsOneWidget);
      // Sin viaje en curso no se escanea ni se termina.
      expect(
        tester
            .widget<FilledButton>(
              find.descendant(
                of: find.byKey(const Key('home-scan')),
                matching: find.byType(FilledButton),
              ),
            )
            .onPressed,
        isNull,
      );

      await tester.tap(find.text('Iniciar viaje'));
      await tester.pumpAndSettle();
      expect(find.text('Revisión de la unidad'), findsOneWidget);
      expect(find.text('Llantas (foto obligatoria)'), findsOneWidget);

      await tester.tap(find.byKey(const Key('ok-tires')));
      await tester.tap(find.byKey(const Key('ok-brakes')));
      await tester.pump();
      // Falta la foto obligatoria.
      expect(
        tester
            .widget<FilledButton>(find.byKey(const Key('checklist-submit')))
            .onPressed,
        isNull,
      );
      await tester.tap(find.byKey(const Key('photo-tires')));
      await tester.pumpAndSettle();
      expect(find.text('Foto lista'), findsOneWidget);
      expect(trips.uploads, ['checklist:foto.jpg']);

      await tester.tap(find.byKey(const Key('checklist-submit')));
      await tester.pumpAndSettle();
      expect(sync.types, ['checklist', 'start']);
      final checklist = sync.received.first['data']! as Map;
      expect(checklist['items'], [
        {'key': 'tires', 'ok': true, 'photoId': 'photo-1'},
        {'key': 'brakes', 'ok': true},
      ]);
      // Pantalla del viaje.
      expect(find.byKey(const Key('trip-map')), findsOneWidget);
      expect(find.text('Plaza · 05:00'), findsOneWidget);
      expect(find.text('0 / 19'), findsOneWidget);
    },
  );

  testWidgets('un checklist con puntos mal no inicia el viaje', (tester) async {
    _tallScreen(tester);
    final sync = FakeSyncApi();
    await pumpApp(
      tester,
      store: _signedIn(),
      repository: FakeAuthRepository(),
      trips: FakeTripRepository(trips: [tripJson()])
        ..template = const [
          ChecklistPoint(key: 'brakes', label: 'Frenos', photoRequired: false),
        ],
      sync: sync,
    );
    await tester.tap(find.text('Iniciar viaje'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('bad-brakes')));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('note-brakes')), 'Rechinan');
    await tester.tap(find.byKey(const Key('checklist-submit')));
    await tester.pumpAndSettle();
    expect(find.text('Hay puntos sin aprobar'), findsOneWidget);
    await tester.tap(find.text('Entendido'));
    await tester.pumpAndSettle();
    expect(find.text('Viajes de hoy'), findsOneWidget);
    expect(sync.types, ['checklist']);
    expect(((sync.received.single['data']! as Map)['items'] as List).single, {
      'key': 'brakes',
      'ok': false,
      'note': 'Rechinan',
    });
  });

  testWidgets('si el servidor rechaza el inicio se explica por qué', (
    tester,
  ) async {
    final sync = FakeSyncApi()
      ..responses['start'] = const ActionResult(
        SyncStatus.rejected,
        message:
            'Todavía es temprano: puedes iniciar este viaje desde las 03:00.',
      );
    await pumpApp(
      tester,
      store: _signedIn(),
      repository: FakeAuthRepository(),
      trips: FakeTripRepository(
        trips: [tripJson(checklistDone: true, checklistPassed: true)],
      ),
      sync: sync,
    );
    await tester.tap(find.text('Iniciar viaje'));
    await tester.pumpAndSettle();
    expect(
      find.text(
        'Todavía es temprano: puedes iniciar este viaje desde las 03:00.',
      ),
      findsOneWidget,
    );
    expect(find.text('Programado'), findsOneWidget);
  });

  testWidgets('sin señal el viaje inicia igual y queda guardado', (
    tester,
  ) async {
    final sync = FakeSyncApi()..offline = true;
    final container = await pumpApp(
      tester,
      store: _signedIn(),
      repository: FakeAuthRepository(),
      trips: FakeTripRepository(
        trips: [tripJson(checklistDone: true, checklistPassed: true)],
      ),
      sync: sync,
    );
    await tester.tap(find.text('Iniciar viaje'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('trip-map')), findsOneWidget);
    expect(await container.read(outboxRepositoryProvider).pendingCount(), 1);
  });

  testWidgets('aviso de parada en pantalla y ubicación en las acciones', (
    tester,
  ) async {
    _tallScreen(tester);
    final sync = FakeSyncApi();
    final gps = FakeLocationSource();
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
    expect(find.byKey(const Key('stop-notice')), findsNothing);

    gps.moveTo(31.7436, -106.46);
    await tester.pumpAndSettle();
    expect(find.text('Plaza a 400 m'), findsOneWidget);

    gps.moveTo(31.7403, -106.46);
    await tester.pumpAndSettle();
    expect(find.text('Llegaste a Plaza. Marca la parada.'), findsOneWidget);

    await tester.tap(find.byKey(const Key('arrive-stop')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stop-notice')), findsNothing);
    expect(sync.received.single['data'], {
      'stopId': 'stop-0',
      'lat': 31.7403,
      'lng': -106.46,
    });
  });

  testWidgets('durante el viaje: parada, incidente y pánico', (tester) async {
    _tallScreen(tester);
    final sync = FakeSyncApi();
    await pumpApp(
      tester,
      store: _signedIn(),
      repository: FakeAuthRepository(),
      trips: FakeTripRepository(trips: [tripJson(status: 'in_progress')]),
      sync: sync,
    );
    await tester.tap(find.text('R-01 · Riberas'));
    await tester.pumpAndSettle();
    expect(find.text('Plaza · 05:00'), findsOneWidget);

    await tester.tap(find.byKey(const Key('arrive-stop')));
    await tester.pumpAndSettle();
    expect(find.text('Tecnológico · 05:15'), findsOneWidget);

    await tester.tap(find.byKey(const Key('trip-incident')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('incident-traffic')));
    await tester.enterText(
      find.byKey(const Key('incident-description')),
      'Choque en el Periférico',
    );
    await tester.tap(find.byKey(const Key('incident-send')));
    await tester.pumpAndSettle();
    expect(find.text('Incidente enviado al despachador.'), findsOneWidget);

    await tester.tap(find.byKey(const Key('panic-button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('panic-confirm')));
    await tester.pumpAndSettle();
    expect(
      find.text('Alerta enviada. El despachador te llamará.'),
      findsOneWidget,
    );

    expect(sync.types, ['stop_arrived', 'incident', 'panic']);
    expect(sync.received[1]['data'], {
      'type': 'traffic',
      'description': 'Choque en el Periférico',
      'photoIds': <String>[],
    });
    expect(sync.received[2]['tripId'], 'trip-1');
  });

  testWidgets(
    'llegada: QR de otra planta se rechaza; el correcto termina el viaje',
    (tester) async {
      final sync = FakeSyncApi()
        ..responses['gate'] = const ActionResult(
          SyncStatus.rejected,
          message: 'Este QR es de otra planta.',
        );
      await pumpApp(
        tester,
        store: _signedIn(),
        repository: FakeAuthRepository(),
        trips: FakeTripRepository(trips: [tripJson(status: 'in_progress')]),
        sync: sync,
      );
      await tester.tap(find.text('Terminar viaje'));
      await tester.pumpAndSettle();
      fakeScannedCode = 'shiftlane-puerta://OTRA';
      await tester.tap(find.byKey(const Key('fake-scan')));
      await tester.pumpAndSettle();
      expect(find.text('Este QR es de otra planta.'), findsOneWidget);

      sync.responses.remove('gate');
      fakeScannedCode = 'shiftlane-puerta://PUERTA1';
      await tester.tap(find.byKey(const Key('fake-scan')));
      await tester.pumpAndSettle();
      expect(find.text('Viaje terminado. ¡Buen trabajo!'), findsOneWidget);
      expect(find.text('Terminado'), findsOneWidget);
      expect(sync.types, ['gate', 'gate', 'finish']);
    },
  );

  testWidgets('se puede terminar sin escanear la puerta (con confirmación)', (
    tester,
  ) async {
    final sync = FakeSyncApi();
    await pumpApp(
      tester,
      store: _signedIn(),
      repository: FakeAuthRepository(),
      trips: FakeTripRepository(trips: [tripJson(status: 'in_progress')]),
      sync: sync,
    );
    await tester.tap(find.text('Terminar viaje'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('finish-without-gate')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('finish-confirm')));
    await tester.pumpAndSettle();
    expect(sync.types, ['finish']);
    expect(find.text('Terminado'), findsOneWidget);
  });

  testWidgets('escaneo manual por número de empleado', (tester) async {
    final sync = FakeSyncApi();
    await pumpApp(
      tester,
      store: _signedIn(),
      repository: FakeAuthRepository(),
      trips: FakeTripRepository(trips: [tripJson(status: 'in_progress')]),
      sync: sync,
    );
    await tester.tap(find.text('Escanear pasajero'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('scan-manual')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('employee-number-field')),
      'A-123',
    );
    await tester.tap(find.text('Registrar'));
    await tester.pumpAndSettle();
    expect(find.text('Bienvenido, Ana.'), findsOneWidget);
    expect(find.text('A bordo: 1'), findsOneWidget);
    expect(sync.received.single['data'], {'employeeNumber': 'A-123'});
  });

  testWidgets('los mensajes del despachador aparecen en pantalla', (
    tester,
  ) async {
    final realtime = FakeRealtimeClient();
    await pumpApp(
      tester,
      store: _signedIn(),
      repository: FakeAuthRepository(),
      realtime: realtime,
    );
    expect(realtime.token, 'access-renovado');
    realtime.controller.add(
      DispatcherMessageEvent(
        DriverMessage(
          id: 'm1',
          text: 'Toma el periférico, hay choque',
          sentAt: DateTime.utc(2026, 10, 5),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('dispatcher-message')), findsOneWidget);
    expect(find.text('Toma el periférico, hay choque'), findsOneWidget);
  });
}
