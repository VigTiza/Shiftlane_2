import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shiftlane_driver/domain/auth/auth_models.dart';

import 'support/fakes.dart';

InMemoryCredentialStore _signedInStore() => InMemoryCredentialStore()
  ..device = const DeviceCredentials(
    deviceId: 'device-1',
    secret: 'secreto-del-celular-123456',
  )
  ..session = (driverId: 'd1', fullName: 'Juan Pérez', refreshToken: 'r');

void main() {
  testWidgets('arranca en la pantalla principal con el ambiente visible', (
    tester,
  ) async {
    await pumpApp(
      tester,
      store: _signedInStore(),
      repository: FakeAuthRepository(),
      environment: 'staging',
    );

    expect(find.text('Shiftlane Chofer'), findsOneWidget);
    expect(find.text('Pruebas'), findsOneWidget);
    expect(find.text('Iniciar viaje'), findsOneWidget);
    expect(find.text('Escanear pasajero'), findsOneWidget);
    expect(find.text('Terminar viaje'), findsOneWidget);
  });

  testWidgets('en producción no se muestra el ambiente', (tester) async {
    await pumpApp(
      tester,
      store: _signedInStore(),
      repository: FakeAuthRepository(),
      environment: 'prod',
    );
    expect(find.byType(Chip), findsNothing);
  });

  testWidgets('sin vincular, abre la pantalla para escanear el QR', (
    tester,
  ) async {
    await pumpApp(
      tester,
      store: InMemoryCredentialStore(),
      repository: FakeAuthRepository(),
    );
    expect(find.text('Vincular celular'), findsOneWidget);
  });
}
