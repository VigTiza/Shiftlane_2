import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shiftlane_driver/application/auth/auth_controller.dart';
import 'package:shiftlane_driver/application/auth/auth_providers.dart';
import 'package:shiftlane_driver/application/providers.dart';
import 'package:shiftlane_driver/core/router/app_router.dart';
import 'package:shiftlane_driver/domain/auth/auth_models.dart';
import 'package:shiftlane_driver/presentation/widgets/pin_pad.dart';

import '../support/fakes.dart';

void main() {
  group('código del QR de alta', () {
    test('lee el código del QR o del texto escrito', () {
      expect(enrollmentCodeFrom(qrPayload), validCode);
      expect(
        enrollmentCodeFrom(
          '  ${validCode.substring(0, 16)} ${validCode.substring(16)} ',
        ),
        validCode,
      );
      expect(enrollmentCodeFrom('https://otra-app.com'), isNull);
      expect(enrollmentCodeFrom('shiftlane-chofer://vincular'), isNull);
      expect(enrollmentCodeFrom('corto'), isNull);
    });
  });

  group('redirección según el acceso', () {
    test('cada estado lleva a su pantalla', () {
      expect(redirectFor(const AuthLoading(), '/'), AppRoutes.loading);
      expect(redirectFor(const AuthNeedsEnrollment(), '/'), AppRoutes.enroll);
      expect(
        redirectFor(const AuthNeedsEnrollment(), AppRoutes.enrollPin),
        isNull,
      );
      expect(redirectFor(const AuthNeedsDriver(), '/'), AppRoutes.selectDriver);
      expect(redirectFor(const AuthNeedsDriver(), AppRoutes.enroll), isNull);
      const session = DriverSession(
        driverId: 'd1',
        fullName: 'Juan',
        accessToken: 'a',
        refreshToken: 'r',
      );
      expect(
        redirectFor(const AuthSignedIn(session), AppRoutes.pin),
        AppRoutes.home,
      );
      expect(redirectFor(const AuthSignedIn(session), AppRoutes.home), isNull);
    });
  });

  testWidgets('teclado de PIN: 4 dígitos, borrar y aviso al completar', (
    tester,
  ) async {
    String? completed;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: PinPad(onCompleted: (pin) => completed = pin)),
      ),
    );
    await tester.tap(find.byKey(const Key('pin-1')));
    await tester.tap(find.byKey(const Key('pin-2')));
    await tester.tap(find.byKey(const Key('pin-borrar')));
    for (final digit in ['3', '4', '5']) {
      await tester.tap(find.byKey(Key('pin-$digit')));
    }
    await tester.pump();
    expect(completed, '1345');
  });

  testWidgets('primer celular: escanea el QR, crea el PIN y entra', (
    tester,
  ) async {
    final store = InMemoryCredentialStore();
    final repository = FakeAuthRepository();
    final container = await pumpApp(
      tester,
      store: store,
      repository: repository,
    );

    expect(find.text('Vincular celular'), findsOneWidget);
    await tester.tap(find.byKey(const Key('fake-scan')));
    await tester.pumpAndSettle();

    expect(find.text('Crea tu PIN'), findsOneWidget);
    await enterPin(tester, '2468');
    expect(find.text('Escríbelo otra vez para confirmar.'), findsOneWidget);
    await enterPin(tester, '1357');
    expect(
      find.text('Los PIN no coinciden. Escríbelo de nuevo.'),
      findsOneWidget,
    );
    await enterPin(tester, '2468');
    await enterPin(tester, '2468');

    expect(find.text('Iniciar viaje'), findsOneWidget);
    expect(find.text('Juan Pérez'), findsOneWidget);
    expect(repository.calls, [
      'enroll:$validCode:-:nuevo',
      'enroll:$validCode:2468:nuevo',
    ]);
    // Credenciales guardadas: el celular y la sesión.
    expect(store.device?.deviceId, 'device-1');
    expect(store.device?.secret, 'secreto-del-celular-123456');
    expect(store.session?.refreshToken, 'refresh-d1');
    expect(container.read(accessTokenProvider), 'access-d1');
  });

  testWidgets(
    'un código que no es de Shiftlane se rechaza sin llamar a la API',
    (tester) async {
      final repository = FakeAuthRepository();
      await pumpApp(
        tester,
        store: InMemoryCredentialStore(),
        repository: repository,
      );
      await tester.tap(find.text('Escribir el código'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('enroll-code-field')),
        'hola',
      );
      await tester.tap(find.text('Vincular'));
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Ese código no es de Shiftlane. Pide al despachador el QR de alta.',
        ),
        findsOneWidget,
      );
      expect(repository.calls, isEmpty);
    },
  );

  testWidgets(
    'celular compartido: elige chofer, PIN incorrecto, correcto y cambio de chofer',
    (tester) async {
      final store = InMemoryCredentialStore()
        ..device = const DeviceCredentials(
          deviceId: 'device-1',
          secret: 'secreto-del-celular-123456',
        );
      final repository = FakeAuthRepository();
      await pumpApp(tester, store: store, repository: repository);

      expect(find.text('¿Quién maneja hoy?'), findsOneWidget);
      expect(find.text('María López'), findsOneWidget);
      await tester.tap(find.text('Juan Pérez'));
      await tester.pumpAndSettle();
      expect(find.text('Hola, Juan Pérez'), findsOneWidget);

      await enterPin(tester, '0000');
      expect(find.text('El PIN no es correcto.'), findsOneWidget);
      await enterPin(tester, '1234');
      expect(find.text('Iniciar viaje'), findsOneWidget);

      await tester.tap(find.byKey(const Key('home-menu')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cambiar de chofer'));
      await tester.pumpAndSettle();
      expect(find.text('¿Quién maneja hoy?'), findsOneWidget);
      expect(store.session, isNull);
      expect(repository.calls, contains('logout:access-d1'));
    },
  );

  testWidgets('PIN restablecido por el despachador: crea uno nuevo', (
    tester,
  ) async {
    final store = InMemoryCredentialStore()
      ..device = const DeviceCredentials(
        deviceId: 'device-1',
        secret: 'secreto-del-celular-123456',
      );
    final repository = FakeAuthRepository();
    await pumpApp(tester, store: store, repository: repository);
    await tester.tap(find.text('María López'));
    await tester.pumpAndSettle();
    expect(find.text('Crea tu PIN nuevo'), findsOneWidget);
    await enterPin(tester, '9753');
    await enterPin(tester, '9753');
    expect(find.text('Iniciar viaje'), findsOneWidget);
    expect(repository.calls, contains('createPin:d2:9753'));
  });

  testWidgets('al abrir la app renueva la sesión guardada', (tester) async {
    final store = InMemoryCredentialStore()
      ..device = const DeviceCredentials(
        deviceId: 'device-1',
        secret: 'secreto-del-celular-123456',
      )
      ..session = (
        driverId: 'd1',
        fullName: 'Juan Pérez',
        refreshToken: 'refresh-viejo',
      );
    final repository = FakeAuthRepository();
    final container = await pumpApp(
      tester,
      store: store,
      repository: repository,
    );
    expect(find.text('Iniciar viaje'), findsOneWidget);
    expect(repository.calls, ['refresh:refresh-viejo']);
    expect(store.session?.refreshToken, 'refresh-renovado');
    expect(container.read(accessTokenProvider), 'access-renovado');
  });

  testWidgets('sin señal al abrir sigue adentro con la sesión guardada', (
    tester,
  ) async {
    final store = InMemoryCredentialStore()
      ..device = const DeviceCredentials(
        deviceId: 'device-1',
        secret: 'secreto-del-celular-123456',
      )
      ..session = (
        driverId: 'd1',
        fullName: 'Juan Pérez',
        refreshToken: 'refresh-viejo',
      );
    final offline = FakeAuthRepository()..offline = true;
    final container = await pumpApp(tester, store: store, repository: offline);
    expect(find.text('Iniciar viaje'), findsOneWidget);
    final state = container.read(authControllerProvider);
    expect(
      state,
      isA<AuthSignedIn>().having((s) => s.offline, 'offline', isTrue),
    );
  });

  testWidgets('con la sesión revocada al abrir, pide elegir chofer y PIN', (
    tester,
  ) async {
    final store = InMemoryCredentialStore()
      ..device = const DeviceCredentials(
        deviceId: 'device-1',
        secret: 'secreto-del-celular-123456',
      )
      ..session = (
        driverId: 'd1',
        fullName: 'Juan Pérez',
        refreshToken: 'refresh-viejo',
      );
    final rejected = FakeAuthRepository()..refreshRejected = true;
    await pumpApp(tester, store: store, repository: rejected);
    expect(find.text('¿Quién maneja hoy?'), findsOneWidget);
    expect(store.session, isNull);
  });
}
