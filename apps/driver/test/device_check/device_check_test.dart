import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shiftlane_driver/application/device_check/device_check_controller.dart';
import 'package:shiftlane_driver/domain/auth/auth_models.dart';
import 'package:shiftlane_driver/domain/device_check/brand_guides.dart';
import 'package:shiftlane_driver/domain/device_check/device_check.dart';

import '../support/fakes.dart';

InMemoryCredentialStore _signedIn() => InMemoryCredentialStore()
  ..device = const DeviceCredentials(
    deviceId: 'device-1',
    secret: 'secreto-del-celular-123456',
  )
  ..session = (driverId: 'd1', fullName: 'Juan Pérez', refreshToken: 'r');

void main() {
  group('reglas de la revisión (iguales a las del servidor)', () {
    test('todo en verde permite iniciar', () {
      final report = evaluateDevice(healthyReadings());
      expect(report.status, CheckStatus.ok);
      expect(report.canStartTrip, isTrue);
      expect(report.results, hasLength(8));
    });

    test('permisos, GPS, ahorro de batería y cámara impiden iniciar', () {
      final report = evaluateDevice(
        healthyReadings(
          locationServiceEnabled: false,
          locationPermission: LocationPermission.whileInUse,
          batteryOptimizationIgnored: false,
          cameraGranted: false,
        ),
      );
      expect(report.canStartTrip, isFalse);
      expect(
        report.results
            .where((r) => r.status == CheckStatus.problem)
            .map((r) => r.item),
        [
          CheckItem.locationService,
          CheckItem.locationAlways,
          CheckItem.batteryOptimization,
          CheckItem.camera,
        ],
      );
      expect(
        report.result(CheckItem.locationAlways).fix,
        FixAction.requestLocationAlways,
      );
    });

    test('batería: muy baja impide, baja avisa, cargando no importa', () {
      expect(
        evaluateDevice(healthyReadings(batteryLevel: 6))
            .result(CheckItem.battery)
            .status,
        CheckStatus.problem,
      );
      final low = evaluateDevice(healthyReadings(batteryLevel: 15));
      expect(low.status, CheckStatus.warning);
      expect(low.canStartTrip, isTrue);
      expect(
        evaluateDevice(healthyReadings(batteryLevel: 4, charging: true)).status,
        CheckStatus.ok,
      );
    });

    test('sin datos solo avisa: se puede seguir sin señal', () {
      final report = evaluateDevice(healthyReadings(network: NetworkType.none));
      expect(report.result(CheckItem.mobileData).status, CheckStatus.warning);
      expect(report.canStartTrip, isTrue);
    });

    test('el servidor agrega la hora desfasada y la versión vieja', () {
      final report = evaluateDevice(healthyReadings()).withServerIssues([
        (
          code: 'clock_skew',
          severity: 'warn',
          message: 'La hora del celular está desfasada 4 min.',
        ),
        (code: 'outdated_app', severity: 'block', message: 'Actualiza la app.'),
      ]);
      expect(report.confirmedByServer, isTrue);
      expect(report.result(CheckItem.clock).status, CheckStatus.warning);
      expect(report.result(CheckItem.appVersion).status, CheckStatus.problem);
      expect(report.canStartTrip, isFalse);
    });

    test('el despachador puede autorizar la salida', () {
      final bad = evaluateDevice(healthyReadings(cameraGranted: false));
      expect(mayStartTrip(bad), isFalse);
      expect(mayStartTrip(bad, dispatcherException: true), isTrue);
      expect(mayStartTrip(null), isFalse);
    });

    test('el reporte para el servidor usa sus nombres', () {
      final report = healthyReadings(
        locationPermission: LocationPermission.whileInUse,
        network: NetworkType.none,
      ).toHealthReport(DateTime.utc(2026, 10, 5, 12));
      expect(report, {
        'recordedAt': '2026-10-05T12:00:00.000Z',
        'batteryPct': 80,
        'charging': false,
        'networkType': 'none',
        'signalLevel': 0,
        'mobileDataEnabled': false,
        'locationPermission': 'while_in_use',
        'gpsEnabled': true,
        'backgroundAllowed': false,
        'batteryOptimizationIgnored': true,
        'cameraPermission': true,
        'appVersion': '0.1.0',
        'osVersion': 'Android 15',
        'platform': 'android',
        'deviceModel': 'motorola Modelo de prueba',
      });
    });
  });

  group('guías por marca', () {
    test('reconoce la marca', () {
      expect(brandFrom('samsung'), PhoneBrand.samsung);
      expect(brandFrom('Xiaomi'), PhoneBrand.xiaomi);
      expect(brandFrom('Redmi'), PhoneBrand.xiaomi);
      expect(brandFrom('motorola'), PhoneBrand.motorola);
      expect(brandFrom('Google'), PhoneBrand.generic);
    });

    test('cada marca tiene sus pasos; lo demás es genérico', () {
      expect(
        guideFor(PhoneBrand.samsung, CheckItem.batteryOptimization).path,
        contains('Aplicaciones en suspensión'),
      );
      expect(
        guideFor(PhoneBrand.xiaomi, CheckItem.batteryOptimization).steps.last,
        contains('Inicio automático'),
      );
      expect(
        guideFor(PhoneBrand.motorola, CheckItem.camera),
        same(guideFor(PhoneBrand.generic, CheckItem.camera)),
      );
      for (final brand in PhoneBrand.values) {
        for (final item in CheckItem.values) {
          expect(guideFor(brand, item).steps, isNotEmpty);
        }
      }
    });
  });

  testWidgets('todo en verde: pasa sola a la pantalla principal y lo reporta', (
    tester,
  ) async {
    final health = FakeDeviceHealthApi();
    final container = await pumpApp(
      tester,
      store: _signedIn(),
      repository: FakeAuthRepository(),
      healthApi: health,
    );
    expect(find.text('Iniciar viaje'), findsOneWidget);
    expect(health.sent, 1);
    expect(container.read(deviceCheckProvider).report?.canStartTrip, isTrue);
  });

  testWidgets(
    'con problemas muestra qué arreglar, los pasos de la marca y abre el ajuste',
    (tester) async {
      // Pantalla alta para ver toda la lista de la revisión.
      tester.view.physicalSize = const Size(1080, 2600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final probe = FakeDeviceProbe(
        healthyReadings(
          manufacturer: 'samsung',
          locationPermission: LocationPermission.whileInUse,
          batteryLevel: 5,
        ),
      );
      final fixer = FakeDeviceFixer(probe);
      await pumpApp(
        tester,
        store: _signedIn(),
        repository: FakeAuthRepository(),
        probe: probe,
        fixer: fixer,
      );

      expect(find.text('Revisión del celular'), findsOneWidget);
      expect(
        find.text('Arregla lo que está en rojo para iniciar viajes'),
        findsOneWidget,
      );
      expect(
        find.text('Batería muy baja (5 %): conecta el cargador de la unidad.'),
        findsOneWidget,
      );
      expect(find.text('Ir al inicio sin iniciar viajes'), findsOneWidget);

      await tester.tap(find.byKey(const Key('check-locationAlways')));
      await tester.pumpAndSettle();
      expect(find.text('En Samsung:'), findsOneWidget);
      expect(find.byKey(const Key('illustration-samsung')), findsOneWidget);
      expect(find.text('3. Activa «Usar ubicación precisa».'), findsOneWidget);

      await tester.tap(find.byKey(const Key('guide-fix')));
      await tester.pumpAndSettle();
      expect(fixer.actions, [FixAction.requestLocationAlways]);
      // Se volvió a revisar: la ubicación ya está en verde, la batería sigue mal.
      expect(
        find.text(
          'Permite la ubicación «Todo el tiempo» para que se vea tu recorrido.',
        ),
        findsNothing,
      );
      expect(
        find.text('Arregla lo que está en rojo para iniciar viajes'),
        findsOneWidget,
      );

      await tester.tap(find.byKey(const Key('check-continue')));
      await tester.pumpAndSettle();
      expect(find.text('Iniciar viaje'), findsOneWidget);
      // En el inicio queda el aviso para volver a la revisión.
      expect(find.byKey(const Key('home-check-banner')), findsOneWidget);
    },
  );

  testWidgets('los avisos del servidor se muestran y permiten continuar', (
    tester,
  ) async {
    final health = FakeDeviceHealthApi()
      ..issues = [
        (
          code: 'clock_skew',
          severity: 'warn',
          message: 'La hora del celular está desfasada 6 min: actívala en automático.',
        ),
      ];
    await pumpApp(
      tester,
      store: _signedIn(),
      repository: FakeAuthRepository(),
      healthApi: health,
    );
    expect(find.text('Puedes iniciar, pero revisa los avisos'), findsOneWidget);
    expect(
      find.text(
        'La hora del celular está desfasada 6 min: actívala en automático.',
      ),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const Key('check-clock')));
    await tester.pumpAndSettle();
    expect(find.text('Abrir fecha y hora'), findsOneWidget);
  });

  testWidgets('sin señal queda la revisión local', (tester) async {
    final health = FakeDeviceHealthApi()..offline = true;
    final container = await pumpApp(
      tester,
      store: _signedIn(),
      repository: FakeAuthRepository(),
      healthApi: health,
    );
    expect(find.text('Iniciar viaje'), findsOneWidget);
    final report = container.read(deviceCheckProvider).report!;
    expect(report.confirmedByServer, isFalse);
    expect(report.canStartTrip, isTrue);
  });
}
