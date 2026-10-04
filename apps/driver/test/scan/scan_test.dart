import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shiftlane_driver/data/local/app_database.dart';
import 'package:shiftlane_driver/data/scan/manifest_repository.dart';
import 'package:shiftlane_driver/domain/auth/auth_models.dart';
import 'package:shiftlane_driver/domain/scan/local_validator.dart';
import 'package:shiftlane_driver/domain/scan/scan_models.dart';
import 'package:shiftlane_driver/domain/trips/stop_notice.dart';
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

/// Respuesta del servidor a un escaneo.
ActionResult _server(
  String result,
  String message, {
  int onboard = 0,
  String? stop,
}) => ActionResult(
  SyncStatus.applied,
  result: {
    'result': result,
    'message': message,
    'onboard': onboard,
    'stop': stop == null ? null : {'id': 'stop-0', 'name': stop},
  },
);

void main() {
  final manifest = TripManifest.fromJson(manifestJson());

  tearDown(() {
    fakeScannedCode = qrPayload;
    fakeScannedIsQr = true;
  });

  group('validación en el celular', () {
    LocalScanResult check({
      String? code,
      String? employeeNumber,
      Set<String> scannedHere = const {},
      TripManifest? list,
    }) => validateLocally(
      list ?? manifest,
      code: code,
      employeeNumber: employeeNumber,
      scannedHere: scannedHere,
    );

    test(
      'correcto con credencial de Shiftlane, gafete o número de empleado',
      () {
        for (final result in [
          check(code: shiftlaneQr(anaSecret)),
          check(code: 'GAF-0001'),
          check(employeeNumber: 'A-123'),
        ]) {
          expect(result.outcome, ScanOutcome.ok);
          expect(result.message, 'Bienvenido, Ana.');
          expect(result.passenger?.id, 'p-ana');
        }
      },
    );

    test('otra ruta, no registrado y ya escaneado', () {
      expect(check(code: 'GAF-0002').outcome, ScanOutcome.otherRoute);
      expect(
        check(employeeNumber: 'B-456').message,
        'Pasajero de otra ruta o turno.',
      );
      final unknown = check(code: 'NUEVO-777');
      expect(unknown.outcome, ScanOutcome.unregistered);
      expect(unknown.passenger, isNull);
      expect(
        check(code: 'GAF-0001', scannedHere: {'p-ana'}).outcome,
        ScanOutcome.alreadyScanned,
      );
      expect(
        check(
          code: 'GAF-0001',
          list: TripManifest.fromJson(manifestJson(boarded: ['p-ana'])),
        ).outcome,
        ScanOutcome.alreadyScanned,
      );
    });

    test(
      'no válido: número desconocido, QR alterado o credencial no vigente',
      () {
        expect(check(employeeNumber: 'X-999').outcome, ScanOutcome.rejected);
        expect(check(code: 'SL1.basura.firma').outcome, ScanOutcome.rejected);
        final stale = check(code: shiftlaneQr('valor-viejo-revocado'));
        expect(stale.outcome, ScanOutcome.rejected);
        expect(stale.message, 'La credencial no está vigente en esta planta.');
        expect(shiftlaneCredentialValue(shiftlaneQr(anaSecret)), anaSecret);
        expect(shiftlaneCredentialValue('GAF-0001'), isNull);
      },
    );

    test('la parada más cercana (hasta 500 m)', () {
      final trip = DriverTrip.fromJson(tripJson(status: 'in_progress'));
      expect(
        nearestStop(trip, (lat: 31.7302, lng: -106.4498))?.name,
        'Tecnológico',
      );
      expect(nearestStop(trip, (lat: 31.80, lng: -106.46)), isNull);
      expect(nearestStop(trip, null), isNull);
    });

    test('la lista y los escaneos quedan guardados en el celular', () async {
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      final store = ManifestStore(db);
      expect(await store.load('trip-1'), isNull);
      await store.save(manifest);
      final saved = (await store.load('trip-1'))!;
      expect(saved.byCredentialHash(sha256Hex('GAF-0002'))?.name, 'Luis M.');
      expect(saved.byEmployeeNumber('A-123')?.onRoute, isTrue);
      await store.markScanned('trip-1', 'p-ana');
      await store.markScanned('trip-1', 'p-ana');
      expect(await store.scanned('trip-1'), {'p-ana'});
      expect(await store.scanned('trip-2'), isEmpty);
    });
  });

  Future<({FakeSyncApi sync, FakeScanFeedback feedback, FakeManifestApi lists})>
  openScanner(
    WidgetTester tester, {
    FakeLocationTracker? gps,
    Map<String, dynamic>? list,
  }) async {
    _tallScreen(tester);
    final sync = FakeSyncApi();
    final feedback = FakeScanFeedback();
    final lists = FakeManifestApi(list ?? manifestJson());
    await pumpApp(
      tester,
      store: _signedIn(),
      repository: FakeAuthRepository(),
      trips: FakeTripRepository(trips: [tripJson(status: 'in_progress')]),
      sync: sync,
      location: gps,
      manifests: lists,
      feedback: feedback,
    );
    await tester.tap(find.text('Escanear pasajero'));
    await tester.pumpAndSettle();
    return (sync: sync, feedback: feedback, lists: lists);
  }

  Future<void> scanCode(
    WidgetTester tester,
    String code, {
    bool qr = true,
  }) async {
    fakeScannedCode = code;
    fakeScannedIsQr = qr;
    await tester.tap(find.byKey(const Key('fake-scan')));
    await tester.pumpAndSettle();
  }

  testWidgets(
    'correcto: suena, cuenta a bordo y asigna la parada por cercanía',
    (tester) async {
      final gps = FakeLocationTracker();
      final s = await openScanner(tester, gps: gps);
      expect(
        find.text('Lista de la planta en el celular: 2 pasajeros.'),
        findsOneWidget,
      );
      gps.moveTo(31.7402, -106.46);
      await tester.pumpAndSettle();
      s.sync.onScan = (_) =>
          _server('ok', 'Bienvenido, Ana.', onboard: 1, stop: 'Plaza');

      await scanCode(tester, shiftlaneQr(anaSecret));
      expect(find.byKey(const Key('scan-outcome-ok')), findsOneWidget);
      expect(find.text('Bienvenido, Ana.'), findsOneWidget);
      expect(find.text('Ana T.'), findsOneWidget);
      expect(find.text('Parada: Plaza'), findsOneWidget);
      expect(find.text('Confirmado por el servidor'), findsOneWidget);
      expect(find.text('A bordo: 1'), findsOneWidget);
      expect(s.feedback.played, [ScanOutcome.ok]);
      expect(s.sync.received.single['data'], {
        'code': shiftlaneQr(anaSecret),
        'codeType': 'qr',
        'lat': 31.7402,
        'lng': -106.46,
      });
    },
  );

  testWidgets('otra ruta: sonido propio y gafete de código de barras', (
    tester,
  ) async {
    final s = await openScanner(tester);
    s.sync.onScan = (_) =>
        _server('other_route', 'Pasajero de otra ruta o turno.', onboard: 1);
    await scanCode(tester, 'GAF-0002', qr: false);
    expect(find.byKey(const Key('scan-outcome-otherRoute')), findsOneWidget);
    expect(find.text('Luis M.'), findsOneWidget);
    expect(s.feedback.played, [ScanOutcome.otherRoute]);
    expect((s.sync.received.single['data']! as Map)['codeType'], 'barcode');
  });

  testWidgets('no registrado: queda provisional', (tester) async {
    final s = await openScanner(tester);
    const message =
        'Gafete no registrado: queda como provisional y la planta lo revisará.';
    s.sync.onScan = (_) => _server('unregistered', message, onboard: 1);
    await scanCode(tester, 'NUEVO-777', qr: false);
    expect(find.byKey(const Key('scan-outcome-unregistered')), findsOneWidget);
    expect(find.text(message), findsOneWidget);
    expect(s.feedback.played, [ScanOutcome.unregistered]);
  });

  testWidgets('ya escaneado: no se registra dos veces', (tester) async {
    final s = await openScanner(tester);
    s.sync.onScan = (_) => _server('ok', 'Bienvenido, Ana.', onboard: 1);
    await scanCode(tester, 'GAF-0001', qr: false);
    await scanCode(tester, shiftlaneQr(anaSecret));
    expect(
      find.byKey(const Key('scan-outcome-alreadyScanned')),
      findsOneWidget,
    );
    expect(find.text('Ya se había escaneado en este viaje.'), findsOneWidget);
    expect(s.feedback.played, [ScanOutcome.ok, ScanOutcome.alreadyScanned]);
    expect(s.sync.types, ['scan']);
    expect(find.text('A bordo: 1'), findsOneWidget);
  });

  testWidgets('no válido: número de empleado que no existe', (tester) async {
    final s = await openScanner(tester);
    const message = 'No se encontró el número de empleado en esta planta.';
    s.sync.onScan = (_) => _server('rejected', message);
    await tester.tap(find.byKey(const Key('scan-manual')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('employee-number-field')),
      'X-999',
    );
    await tester.tap(find.text('Registrar'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('scan-outcome-rejected')), findsOneWidget);
    expect(find.text(message), findsOneWidget);
    expect(s.feedback.played, [ScanOutcome.rejected]);
    expect(find.text('A bordo: 0'), findsOneWidget);
  });

  testWidgets('registro manual por número de empleado', (tester) async {
    final s = await openScanner(tester);
    s.sync.onScan = (_) => _server('ok', 'Bienvenido, Ana.', onboard: 1);
    await tester.tap(find.byKey(const Key('scan-manual')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('employee-number-field')),
      'A-123',
    );
    await tester.tap(find.text('Registrar'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('scan-outcome-ok')), findsOneWidget);
    expect(s.sync.received.single['data'], {'employeeNumber': 'A-123'});
  });

  testWidgets(
    'sin señal: valida con la lista descargada y cuenta solo a quien sube',
    (tester) async {
      final s = await openScanner(tester);
      // La lista se descargó al abrir el inicio; ahora se pierde la señal.
      s.sync.offline = true;
      s.lists.offline = true;
      await scanCode(tester, 'GAF-0001', qr: false);
      expect(find.byKey(const Key('scan-outcome-ok')), findsOneWidget);
      expect(
        find.text('Guardado sin señal; se confirma al sincronizar'),
        findsOneWidget,
      );
      expect(find.text('A bordo: 1'), findsOneWidget);

      await tester.tap(find.byKey(const Key('scan-manual')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('employee-number-field')),
        'X-999',
      );
      await tester.tap(find.text('Registrar'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('scan-outcome-rejected')), findsOneWidget);
      expect(find.text('A bordo: 1'), findsOneWidget);
      expect(s.feedback.played, [ScanOutcome.ok, ScanOutcome.rejected]);
      expect(s.lists.fetches, 1);
    },
  );

  testWidgets('si el servidor responde distinto, manda el servidor', (
    tester,
  ) async {
    final s = await openScanner(tester);
    // Ana ya había subido en otro celular: la lista de este no lo sabía.
    s.sync.onScan = (_) => _server(
      'already_scanned',
      'Ya se había escaneado en este viaje.',
      onboard: 1,
    );
    await scanCode(tester, 'GAF-0001', qr: false);
    expect(
      find.byKey(const Key('scan-outcome-alreadyScanned')),
      findsOneWidget,
    );
    expect(find.text('Confirmado por el servidor'), findsOneWidget);
    expect(s.feedback.played, [ScanOutcome.ok, ScanOutcome.alreadyScanned]);
  });

  testWidgets('sin lista en el celular valida solo el servidor', (
    tester,
  ) async {
    _tallScreen(tester);
    final sync = FakeSyncApi()
      ..onScan = (_) => _server('ok', 'Bienvenido, Ana.', onboard: 1);
    final feedback = FakeScanFeedback();
    await pumpApp(
      tester,
      store: _signedIn(),
      repository: FakeAuthRepository(),
      trips: FakeTripRepository(trips: [tripJson(status: 'in_progress')]),
      sync: sync,
      feedback: feedback,
    );
    await tester.tap(find.text('Escanear pasajero'));
    await tester.pumpAndSettle();
    expect(
      find.text('Sin lista de pasajeros en el celular: valida el servidor.'),
      findsOneWidget,
    );
    await scanCode(tester, 'GAF-0001', qr: false);
    expect(find.byKey(const Key('scan-outcome-ok')), findsOneWidget);
    expect(feedback.played, [ScanOutcome.ok]);
  });
}
