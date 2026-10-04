import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shiftlane_driver/application/tutorial/tutorial_controller.dart';
import 'package:shiftlane_driver/core/config/environment.dart';
import 'package:shiftlane_driver/data/push/push_service.dart';
import 'package:shiftlane_driver/domain/app_version/app_version.dart';
import 'package:shiftlane_driver/domain/auth/auth_models.dart';

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

const _download = 'https://descargas.shiftlane.mx/chofer.apk';

void main() {
  group('versiones', () {
    test('compara por número', () {
      expect(compareVersions('1.2.10', '1.2.9'), 1);
      expect(compareVersions('1.2', '1.2.0'), 0);
      expect(compareVersions('0.9.9+12', '1.0.0'), -1);
    });

    test('obligatoria, sugerida o al día', () {
      const info = AppVersionInfo(minVersion: '1.0.0', latestVersion: '1.4.1');
      expect(updateLevelFor('0.9.0', info), UpdateLevel.required);
      expect(updateLevelFor('1.2.0', info), UpdateLevel.suggested);
      expect(updateLevelFor('1.4.1', info), UpdateLevel.none);
      expect(updateLevelFor('0.1.0', const AppVersionInfo()), UpdateLevel.none);
    });

    test('Firebase solo con sus cuatro valores', () {
      expect(AppConfig.fromValues(firebaseApiKey: 'k').firebase, isNull);
      final config = AppConfig.fromValues(
        firebaseApiKey: 'k',
        firebaseAppId: '1:2:android:3',
        firebaseSenderId: '2',
        firebaseProjectId: 'shiftlane',
      );
      expect(config.firebase?.projectId, 'shiftlane');
    });
  });

  testWidgets('actualización obligatoria: bloquea y abre la descarga', (
    tester,
  ) async {
    final versions = FakeAppVersionApi(
      const AppVersionInfo(minVersion: '1.0.0', downloadUrl: _download),
    );
    final opened = <Uri>[];
    await pumpApp(
      tester,
      store: _signedIn(),
      repository: FakeAuthRepository(),
      versions: versions,
      openedUrls: opened,
    );
    expect(find.text('Actualiza la app'), findsOneWidget);
    expect(
      find.text(
        'Tienes la versión 0.1.0 y se necesita la 1.0.0 para seguir trabajando.',
      ),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const Key('update-download')));
    await tester.pumpAndSettle();
    expect(opened, [Uri.parse(_download)]);

    // Ya instaló la nueva (aquí: el servidor bajó la mínima).
    versions.info = const AppVersionInfo();
    await tester.tap(find.byKey(const Key('update-retry')));
    await tester.pumpAndSettle();
    expect(find.text('Viajes de hoy'), findsOneWidget);
  });

  testWidgets('a mitad de un viaje no bloquea: primero se termina', (
    tester,
  ) async {
    _tallScreen(tester);
    await pumpApp(
      tester,
      store: _signedIn(),
      repository: FakeAuthRepository(),
      trips: FakeTripRepository(trips: [tripJson(status: 'in_progress')]),
      versions: FakeAppVersionApi(const AppVersionInfo(minVersion: '1.0.0')),
    );
    expect(find.text('Viajes de hoy'), findsOneWidget);
    expect(
      find.text('Al terminar el viaje tendrás que actualizar la app.'),
      findsOneWidget,
    );
    await tester.tap(find.text('Terminar viaje'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('finish-without-gate')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('finish-confirm')));
    await tester.pumpAndSettle();
    expect(find.text('Actualiza la app'), findsOneWidget);
    expect(
      find.text('Pide al despachador la versión nueva de la app.'),
      findsOneWidget,
    );
  });

  testWidgets('versión nueva sugerida: aviso en el inicio', (tester) async {
    final opened = <Uri>[];
    await pumpApp(
      tester,
      store: _signedIn(),
      repository: FakeAuthRepository(),
      versions: FakeAppVersionApi(
        const AppVersionInfo(latestVersion: '1.4.1', downloadUrl: _download),
      ),
      openedUrls: opened,
    );
    expect(
      find.text('Hay una versión nueva de la app (1.4.1).'),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const Key('update-banner-action')));
    await tester.pumpAndSettle();
    expect(opened, [Uri.parse(_download)]);
  });

  testWidgets('sin señal la revisión de versión no estorba', (tester) async {
    await pumpApp(
      tester,
      store: _signedIn(),
      repository: FakeAuthRepository(),
      versions: FakeAppVersionApi()..offline = true,
    );
    expect(find.text('Viajes de hoy'), findsOneWidget);
    expect(find.byKey(const Key('update-banner')), findsNothing);
  });

  testWidgets('tutorial la primera vez que entra el chofer', (tester) async {
    final container = await pumpApp(
      tester,
      store: _signedIn(),
      repository: FakeAuthRepository(),
      tutorialSeen: false,
    );
    expect(find.text('Bienvenido a Shiftlane'), findsOneWidget);
    for (var i = 0; i < 5; i++) {
      await tester.tap(find.byKey(const Key('tutorial-next')));
      await tester.pumpAndSettle();
    }
    expect(find.text('Pánico y ayuda'), findsOneWidget);
    await tester.tap(find.byKey(const Key('tutorial-done')));
    await tester.pumpAndSettle();
    expect(find.text('Viajes de hoy'), findsOneWidget);
    expect(container.read(tutorialControllerProvider), isTrue);
    expect(
      await container.read(localFlagsProvider).isSet('tutorial_seen:d1'),
      isTrue,
    );

    // Se puede volver a ver desde el menú.
    await tester.tap(find.byKey(const Key('home-menu')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ver tutorial'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('tutorial-skip')));
    await tester.pumpAndSettle();
    expect(find.text('Viajes de hoy'), findsOneWidget);
  });

  testWidgets('avisos: registra el token y atiende las notificaciones', (
    tester,
  ) async {
    final push = FakePushService();
    final tokens = FakePushTokenApi();
    final trips = FakeTripRepository(trips: [tripJson()]);
    await pumpApp(
      tester,
      store: _signedIn(),
      repository: FakeAuthRepository(),
      trips: trips,
      push: push,
      pushTokens: tokens,
    );
    expect(tokens.saved, ['fcm-token-de-prueba']);

    push.tokens.add('fcm-token-renovado');
    await tester.pumpAndSettle();
    expect(tokens.saved, ['fcm-token-de-prueba', 'fcm-token-renovado']);

    final loads = trips.loads;
    push.controller.add(
      const PushNotice(type: 'trip_cancelled', data: {'tripId': 'trip-1'}),
    );
    await tester.pumpAndSettle();
    expect(trips.loads, loads + 1);

    push.controller.add(
      const PushNotice(
        type: 'message',
        data: {'messageId': 'm1'},
        body: 'Pasa por la puerta 3',
        openedFromTray: true,
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('dispatcher-message')), findsOneWidget);
    expect(find.text('Pasa por la puerta 3'), findsOneWidget);
  });

  testWidgets('«Tengo un problema»: soluciones y diagnóstico', (tester) async {
    _tallScreen(tester);
    final health = FakeDeviceHealthApi();
    final trips = FakeTripRepository(trips: [tripJson()]);
    await pumpApp(
      tester,
      store: _signedIn(),
      repository: FakeAuthRepository(),
      healthApi: health,
      trips: trips,
    );
    await tester.tap(find.byKey(const Key('home-help')));
    await tester.pumpAndSettle();
    expect(find.text('Tengo un problema'), findsOneWidget);

    await tester.tap(find.byKey(const Key('help-signal')));
    await tester.pumpAndSettle();
    expect(find.textContaining('No hay nada pendiente.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('help-signal-action')));
    await tester.pumpAndSettle();
    expect(find.text('Todo quedó enviado.'), findsOneWidget);

    await tester.tap(find.byKey(const Key('help-trips')));
    await tester.pumpAndSettle();
    final loads = trips.loads;
    await tester.tap(find.byKey(const Key('help-trips-action')));
    await tester.pumpAndSettle();
    expect(trips.loads, loads + 1);

    final sent = health.sent;
    await tester.tap(find.byKey(const Key('help-diagnostic')));
    await tester.pumpAndSettle();
    expect(health.sent, sent + 1);
    expect(find.text('Diagnóstico enviado al despachador.'), findsOneWidget);

    await tester.tap(find.byKey(const Key('help-gps')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('help-gps-action')));
    await tester.pumpAndSettle();
    // La revisión corre (y se reporta); con todo en verde regresa sola al inicio.
    expect(health.sent, sent + 2);
    expect(find.text('Viajes de hoy'), findsOneWidget);
  });
}
