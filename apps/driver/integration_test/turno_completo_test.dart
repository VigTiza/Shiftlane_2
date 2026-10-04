// Turno completo contra la API local (la orquesta `pnpm e2e:chofer`, que crea la empresa con
// el simulador y pasa los datos con --dart-define-from-file). Todo es real (API, cola,
// sincronización, tiempo real, lista de escaneo) salvo la cámara, el GPS, los sensores del
// celular y el almacenamiento seguro, que no existen en la computadora.
import 'dart:async';
import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:shiftlane_driver/app.dart';
import 'package:shiftlane_driver/application/auth/auth_providers.dart';
import 'package:shiftlane_driver/application/device_check/device_check_controller.dart';
import 'package:shiftlane_driver/application/providers.dart';
import 'package:shiftlane_driver/application/scan/scan_controller.dart';
import 'package:shiftlane_driver/application/sync/sync_coordinator.dart';
import 'package:shiftlane_driver/application/tracking/trip_tracking.dart';
import 'package:shiftlane_driver/application/trips/trip_providers.dart';
import 'package:shiftlane_driver/application/trips/trips_controller.dart';
import 'package:shiftlane_driver/application/update/update_controller.dart';
import 'package:shiftlane_driver/core/config/environment.dart';
import 'package:shiftlane_driver/data/local/app_database.dart';
import 'package:shiftlane_driver/domain/tracking/gps_fix.dart';

import '../test/support/fakes.dart';

const _apiUrl = String.fromEnvironment('E2E_API_URL');
const _enrollQr = String.fromEnvironment('E2E_ENROLL_QR');
const _tripId = String.fromEnvironment('E2E_TRIP_ID');
const _employee = String.fromEnvironment('E2E_EMPLOYEE');
const _gateQr = String.fromEnvironment('E2E_GATE_QR');

/// PNG de 1×1 (la API revisa que la foto sea una imagen de verdad).
final _png = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
);

/// GPS que emite lecturas con la hora real (el servidor solo acepta las del viaje).
class _RealTimeTracker implements LocationTracker {
  final _controller = StreamController<GpsFix>.broadcast();

  void at(double lat, double lng) => _controller.add(
    GpsFix(
      lat: lat,
      lng: lng,
      recordedAt: DateTime.now().toUtc(),
      speedKmh: 25,
      accuracyM: 6,
    ),
  );

  @override
  Stream<GpsFix> watch() => _controller.stream;
}

/// Espera (con tiempo real) a que aparezca algo en pantalla.
Future<void> pumpUntil(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 30),
}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 100));
    if (finder.evaluate().isNotEmpty) return;
    await Future<void>.delayed(const Duration(milliseconds: 150));
  }
  throw TimeoutException('No apareció: $finder');
}

Future<void> tapAndWait(WidgetTester tester, Finder target, Finder next) async {
  await pumpUntil(tester, target);
  await tester.tap(target);
  await pumpUntil(tester, next);
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'turno completo del chofer contra la API local',
    (tester) async {
      tester.view.physicalSize = const Size(1080, 2600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      final gps = _RealTimeTracker();
      final probe = FakeDeviceProbe();
      final container = ProviderContainer(
        retry: (_, _) => null,
        overrides: [
          appConfigProvider.overrideWithValue(
            AppConfig.fromValues(environment: 'dev', apiUrl: _apiUrl),
          ),
          appDatabaseProvider.overrideWithValue(db),
          credentialStoreProvider.overrideWithValue(InMemoryCredentialStore()),
          qrScannerProvider.overrideWithValue(fakeScanner),
          codeScannerProvider.overrideWithValue(fakeCodeScanner),
          deviceProbeProvider.overrideWithValue(probe),
          deviceFixerProvider.overrideWithValue(FakeDeviceFixer(probe)),
          locationTrackerProvider.overrideWithValue(gps),
          connectivityMonitorProvider.overrideWithValue(FakeConnectivity()),
          mapTilesEnabledProvider.overrideWithValue(false),
          photoCaptureProvider.overrideWithValue(
            () async => (bytes: _png, name: 'llanta.png'),
          ),
          scanFeedbackProvider.overrideWithValue(FakeScanFeedback()),
          currentAppVersionProvider.overrideWith((ref) async => '1.0.0'),
          urlOpenerProvider.overrideWithValue((_) async => true),
        ],
      );
      addTearDown(container.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const ShiftlaneDriverApp(),
        ),
      );

      // 1. Alta del celular con el QR del despachador y PIN nuevo.
      fakeScannedCode = _enrollQr;
      await tapAndWait(
        tester,
        find.byKey(const Key('fake-scan')),
        find.text('Crea tu PIN'),
      );
      for (var round = 0; round < 2; round++) {
        for (final digit in '2468'.split('')) {
          await tester.tap(find.byKey(Key('pin-$digit')));
          await tester.pump();
        }
        await tester.pump(const Duration(milliseconds: 300));
      }

      // 2. Revisión del celular (se reporta al servidor) y tutorial de la primera vez.
      await pumpUntil(tester, find.byKey(const Key('tutorial-skip')));
      await tapAndWait(
        tester,
        find.byKey(const Key('tutorial-skip')),
        find.text('Viajes de hoy'),
      );

      // 3. Checklist con la foto obligatoria e inicio del viaje.
      await pumpUntil(tester, find.text('Programado'));
      await tapAndWait(
        tester,
        find.text('Iniciar viaje'),
        find.byKey(const Key('checklist-submit')),
      );
      final template = await container
          .read(tripsControllerProvider.notifier)
          .checklistTemplate();
      for (final point in template) {
        await tester.tap(find.byKey(Key('ok-${point.key}')));
        await tester.pump();
        if (point.photoRequired) {
          await tester.tap(find.byKey(Key('photo-${point.key}')));
          await pumpUntil(tester, find.text('Foto lista'));
        }
      }
      await tapAndWait(
        tester,
        find.byKey(const Key('checklist-submit')),
        find.byKey(const Key('trip-map')),
      );
      final trip = container.read(currentTripProvider)!;
      expect(trip.id, _tripId);

      // 4. Primera parada: llegada, GPS y escaneo del pasajero (validado por el servidor).
      await tester.tap(find.byKey(const Key('arrive-stop')));
      await pumpUntil(
        tester,
        find.textContaining(trip.stops[1].name, findRichText: true),
      );
      final first = trip.stops.first;
      gps.at(first.lat, first.lng);
      await tester.pump(const Duration(seconds: 1));
      await tapAndWait(
        tester,
        find.byKey(const Key('trip-scan')),
        find.byKey(const Key('scan-manual')),
      );
      await tester.tap(find.byKey(const Key('scan-manual')));
      await pumpUntil(tester, find.byKey(const Key('employee-number-field')));
      await tester.enterText(
        find.byKey(const Key('employee-number-field')),
        _employee,
      );
      await tester.tap(find.text('Registrar'));
      await pumpUntil(tester, find.text('Confirmado por el servidor'));
      expect(find.byKey(const Key('scan-outcome-ok')), findsOneWidget);
      expect(find.text('A bordo: 1'), findsOneWidget);
      await tester.pageBack();
      await tester.pump(const Duration(milliseconds: 500));

      // 5. Rumbo a la planta: otra posición 10 s después (una cada 10 s).
      await Future<void>.delayed(const Duration(seconds: 11));
      final last = trip.stops.last;
      gps.at(last.lat, last.lng);
      await tester.pump(const Duration(seconds: 1));

      // 6. Llegada con el QR de la puerta: termina el viaje.
      fakeScannedCode = _gateQr;
      await tapAndWait(
        tester,
        find.byKey(const Key('trip-arrival')),
        find.byKey(const Key('fake-scan')),
      );
      await tester.tap(find.byKey(const Key('fake-scan')));
      await pumpUntil(tester, find.text('Viaje terminado. ¡Buen trabajo!'));
      await pumpUntil(tester, find.text('Terminado'));

      // 7. Nada quedó pendiente en el celular.
      final end = DateTime.now().add(const Duration(seconds: 20));
      while (container.read(syncCoordinatorProvider).pending > 0 &&
          DateTime.now().isBefore(end)) {
        await container.read(syncCoordinatorProvider.notifier).syncNow();
        await Future<void>.delayed(const Duration(milliseconds: 500));
      }
      expect(await container.read(outboxRepositoryProvider).pendingCount(), 0);
    },
    skip: _apiUrl.isEmpty,
    timeout: const Timeout(Duration(minutes: 4)),
  );
}
