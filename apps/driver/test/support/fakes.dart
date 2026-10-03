import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shiftlane_driver/app.dart';
import 'package:shiftlane_driver/application/auth/auth_providers.dart';
import 'package:shiftlane_driver/application/providers.dart';
import 'package:shiftlane_driver/core/config/environment.dart';
import 'package:shiftlane_driver/core/errors/app_failure.dart';
import 'package:shiftlane_driver/data/local/app_database.dart';
import 'package:shiftlane_driver/domain/auth/auth_models.dart';

const validCode = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
const qrPayload = 'shiftlane-chofer://vincular?codigo=$validCode';

class InMemoryCredentialStore implements CredentialStore {
  DeviceCredentials? device;
  ({String driverId, String fullName, String refreshToken})? session;

  @override
  Future<DeviceCredentials?> readDevice() async => device;

  @override
  Future<void> writeDevice(DeviceCredentials credentials) async =>
      device = credentials;

  @override
  Future<({String driverId, String fullName, String refreshToken})?>
  readSession() async => session;

  @override
  Future<void> writeSession({
    required String driverId,
    required String fullName,
    required String refreshToken,
  }) async => session = (
    driverId: driverId,
    fullName: fullName,
    refreshToken: refreshToken,
  );

  @override
  Future<void> clearSession() async => session = null;
}

/// API de acceso simulada: un chofer con PIN 1234 y otro con el PIN restablecido.
class FakeAuthRepository implements AuthRepository {
  final List<String> calls = [];
  bool driverHasPin = false;
  bool offline = false;
  bool refreshRejected = false;
  final drivers = <LinkedDriver>[
    const LinkedDriver(id: 'd1', fullName: 'Juan Pérez', pinSet: true),
    const LinkedDriver(id: 'd2', fullName: 'María López', pinSet: false),
  ];

  AuthTokens _tokens(String who) =>
      AuthTokens(accessToken: 'access-$who', refreshToken: 'refresh-$who');

  @override
  Future<EnrollResult> enroll({
    required String code,
    String? pin,
    DeviceCredentials? device,
  }) async {
    calls.add('enroll:$code:${pin ?? '-'}:${device?.deviceId ?? 'nuevo'}');
    if (code != validCode) {
      throw const UnauthorizedFailure(
        'El código QR no es válido o ya se usó. Pide uno nuevo al despachador.',
      );
    }
    if (!driverHasPin && pin == null) {
      throw const ValidationFailure(
        'Crea un PIN de 4 dígitos para entrar a la app.',
        code: 'PIN_REQUIRED',
      );
    }
    return EnrollResult(
      tokens: _tokens('d1'),
      driverId: 'd1',
      fullName: 'Juan Pérez',
      deviceId: device?.deviceId ?? 'device-1',
      newDeviceSecret: device == null ? 'secreto-del-celular-123456' : null,
    );
  }

  @override
  Future<List<LinkedDriver>> linkedDrivers(DeviceCredentials device) async {
    calls.add('drivers');
    return drivers;
  }

  @override
  Future<AuthTokens> login(
    DeviceCredentials device, {
    required String driverId,
    required String pin,
  }) async {
    calls.add('login:$driverId:$pin');
    if (driverId == 'd2') {
      throw const ConflictFailure(
        'Necesitas crear un PIN nuevo.',
        code: 'PIN_NOT_SET',
      );
    }
    if (pin != '1234') {
      throw const UnauthorizedFailure('El PIN no es correcto.');
    }
    return _tokens(driverId);
  }

  @override
  Future<AuthTokens> createPin(
    DeviceCredentials device, {
    required String driverId,
    required String pin,
  }) async {
    calls.add('createPin:$driverId:$pin');
    return _tokens(driverId);
  }

  @override
  Future<AuthTokens> refresh(String refreshToken) async {
    calls.add('refresh:$refreshToken');
    if (offline) throw const NetworkFailure();
    if (refreshRejected) throw const UnauthorizedFailure();
    return const AuthTokens(
      accessToken: 'access-renovado',
      refreshToken: 'refresh-renovado',
    );
  }

  @override
  Future<void> logout(String accessToken) async =>
      calls.add('logout:$accessToken');
}

/// Lector de QR de prueba: un botón que «escanea» el código indicado.
Widget fakeScanner(BuildContext context, ValueChanged<String> onCode) => Center(
  child: ElevatedButton(
    key: const Key('fake-scan'),
    onPressed: () => onCode(qrPayload),
    child: const Text('Simular escaneo'),
  ),
);

Future<ProviderContainer> pumpApp(
  WidgetTester tester, {
  required InMemoryCredentialStore store,
  required FakeAuthRepository repository,
  String environment = 'dev',
}) async {
  final db = AppDatabase(NativeDatabase.memory());
  addTearDown(db.close);
  final container = ProviderContainer(
    overrides: [
      appConfigProvider.overrideWithValue(
        AppConfig.fromValues(environment: environment),
      ),
      appDatabaseProvider.overrideWithValue(db),
      credentialStoreProvider.overrideWithValue(store),
      authRepositoryProvider.overrideWithValue(repository),
      qrScannerProvider.overrideWithValue(fakeScanner),
    ],
  );
  addTearDown(container.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: const ShiftlaneDriverApp(),
    ),
  );
  await tester.pumpAndSettle();
  return container;
}

/// Escribe un PIN en el teclado.
Future<void> enterPin(WidgetTester tester, String pin) async {
  for (final digit in pin.split('')) {
    await tester.tap(find.byKey(Key('pin-$digit')));
    await tester.pump();
  }
  await tester.pumpAndSettle();
}
