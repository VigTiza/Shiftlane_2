import 'dart:async';

import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shiftlane_driver/app.dart';
import 'package:dio/dio.dart';
import 'package:shiftlane_driver/application/auth/auth_providers.dart';
import 'package:shiftlane_driver/application/device_check/device_check_controller.dart';
import 'package:shiftlane_driver/application/realtime/realtime_providers.dart';
import 'package:shiftlane_driver/application/sync/sync_coordinator.dart';
import 'package:shiftlane_driver/application/tracking/trip_tracking.dart';
import 'package:shiftlane_driver/application/trips/trip_providers.dart';
import 'package:shiftlane_driver/data/sync/connectivity_monitor.dart';
import 'package:shiftlane_driver/domain/tracking/gps_fix.dart';
import 'package:shiftlane_driver/data/realtime/socket_realtime_client.dart';
import 'package:shiftlane_driver/data/sync/sync_api.dart';
import 'package:shiftlane_driver/domain/trips/trip_models.dart';
import 'package:shiftlane_driver/core/network/api_client.dart';
import 'package:shiftlane_driver/data/device_check/device_health_api.dart';
import 'package:shiftlane_driver/domain/device_check/device_check.dart';
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

/// Lecturas simuladas del celular (por omisión, todo en verde).
class FakeDeviceProbe implements DeviceProbe {
  FakeDeviceProbe([DeviceReadings? readings])
    : readings = readings ?? healthyReadings();

  DeviceReadings readings;

  @override
  Future<DeviceReadings> read() async => readings;
}

DeviceReadings healthyReadings({
  bool locationServiceEnabled = true,
  LocationPermission locationPermission = LocationPermission.always,
  bool batteryOptimizationIgnored = true,
  int batteryLevel = 80,
  bool charging = false,
  NetworkType network = NetworkType.cellular,
  bool cameraGranted = true,
  String manufacturer = 'motorola',
}) => DeviceReadings(
  locationServiceEnabled: locationServiceEnabled,
  locationPermission: locationPermission,
  batteryOptimizationIgnored: batteryOptimizationIgnored,
  batteryLevel: batteryLevel,
  charging: charging,
  network: network,
  cameraGranted: cameraGranted,
  appVersion: '0.1.0',
  manufacturer: manufacturer,
  model: 'Modelo de prueba',
  osVersion: 'Android 15',
);

/// Arreglos simulados: registra la acción y la aplica a las lecturas.
class FakeDeviceFixer implements DeviceFixer {
  FakeDeviceFixer(this.probe);

  final FakeDeviceProbe probe;
  final List<FixAction> actions = [];

  @override
  Future<void> fix(FixAction action) async {
    actions.add(action);
    final r = probe.readings;
    probe.readings = healthyReadings(
      manufacturer: r.manufacturer,
      locationServiceEnabled: r.locationServiceEnabled,
      locationPermission: action == FixAction.requestLocationAlways
          ? LocationPermission.always
          : r.locationPermission,
      batteryOptimizationIgnored:
          r.batteryOptimizationIgnored ||
          action == FixAction.disableBatteryOptimization,
      batteryLevel: r.batteryLevel,
      charging: r.charging,
      network: r.network,
      cameraGranted: r.cameraGranted || action == FixAction.requestCamera,
    );
  }
}

/// Servidor de salud simulado: responde los problemas indicados o falla sin señal.
class FakeDeviceHealthApi extends DeviceHealthApi {
  FakeDeviceHealthApi() : super(ApiClient(Dio()));

  List<ServerIssue> issues = [];
  bool offline = false;
  int sent = 0;

  @override
  Future<List<ServerIssue>> send(
    DeviceReadings readings, {
    DateTime? now,
  }) async {
    if (offline) throw const NetworkFailure();
    sent += 1;
    return issues;
  }
}

/// Código que «lee» el lector de prueba (cada prueba puede cambiarlo).
String fakeScannedCode = qrPayload;

/// Lector de QR de prueba: un botón que «escanea» el código indicado.
Widget fakeScanner(BuildContext context, ValueChanged<String> onCode) => Center(
  child: ElevatedButton(
    key: const Key('fake-scan'),
    onPressed: () => onCode(fakeScannedCode),
    child: const Text('Simular escaneo'),
  ),
);

/// Viaje de ejemplo con tres paradas (respuesta de GET /driver/trips).
Map<String, dynamic> tripJson({
  String id = 'trip-1',
  String status = 'scheduled',
  bool checklistDone = false,
  bool checklistPassed = false,
  bool exceptionAuthorized = false,
  int onboard = 0,
  int capacity = 19,
}) => {
  'id': id,
  'status': status,
  'kind': 'regular',
  'direction': 'inbound',
  'serviceDate': '2026-10-05',
  'scheduledStartAt': '2026-10-05T11:00:00.000Z',
  'scheduledEndAt': '2026-10-05T12:00:00.000Z',
  'canStartFrom': '2026-10-05T09:00:00.000Z',
  'route': {'id': 'route-1', 'code': 'R-01', 'name': 'Riberas'},
  'plant': {'id': 'plant-1', 'name': 'Planta Norte'},
  'vehicle': {'id': 'v-1', 'economicNumber': 'U-014', 'capacity': capacity},
  'expectedPassengers': 12,
  'onboard': onboard,
  'checklist': {
    'done': checklistDone,
    'passed': checklistPassed,
    'exceptionAuthorized': exceptionAuthorized,
  },
  'stops': [
    for (final (i, name) in ['Plaza', 'Tecnológico', 'Waterfill'].indexed)
      {
        'id': 'stop-$i',
        'sequence': i,
        'name': name,
        'location': {'lat': 31.74 - i * 0.01, 'lng': -106.46 + i * 0.01},
        'radiusMeters': 80,
        'times': [
          {
            'weekdays': <int>[],
            'time': '05:${(i * 15).toString().padLeft(2, '0')}',
          },
        ],
      },
  ],
};

class FakeTripRepository implements TripRepository {
  FakeTripRepository({List<Map<String, dynamic>>? trips}) : trips = trips ?? [];

  List<Map<String, dynamic>> trips;
  List<ChecklistPoint> template = const [
    ChecklistPoint(key: 'tires', label: 'Llantas', photoRequired: true),
    ChecklistPoint(key: 'brakes', label: 'Frenos', photoRequired: false),
  ];
  final List<String> uploads = [];
  bool offline = false;

  @override
  Future<List<DriverTrip>> todayTrips() async {
    if (offline) throw const NetworkFailure();
    return trips.map(DriverTrip.fromJson).toList();
  }

  @override
  Future<List<ChecklistPoint>> checklistTemplate() async => template;

  @override
  Future<String> uploadPhoto(
    String tripId,
    String kind,
    List<int> bytes,
    String fileName,
  ) async {
    uploads.add('$kind:$fileName');
    return 'photo-${uploads.length}';
  }
}

/// Servidor de sincronización simulado: aplica todo salvo lo que se configure.
class FakeSyncApi extends SyncApi {
  FakeSyncApi() : super(ApiClient(Dio()));

  bool offline = false;
  final Map<String, ActionResult> responses = {};
  final List<Map<String, Object?>> received = [];
  int onboard = 0;

  /// Posiciones recibidas en /driver/positions y llegadas que «detecta» el servidor.
  final List<Map<String, Object?>> positions = [];
  List<AutoArrival> autoArrivals = [];
  AppFailure? positionsFailure;
  int positionBatches = 0;

  @override
  Future<PositionsReceipt> sendPositions(
    List<Map<String, Object?>> points,
  ) async {
    if (offline) throw const NetworkFailure();
    if (positionsFailure != null) throw positionsFailure!;
    calls.add('positions');
    positionBatches += 1;
    positions.addAll(points);
    final arrivals = autoArrivals;
    autoArrivals = [];
    return PositionsReceipt(
      accepted: points.length,
      duplicates: 0,
      rejected: 0,
      autoArrivals: arrivals,
    );
  }

  /// Orden de las llamadas ('batch' o 'positions') e intentos de envío de acciones.
  final List<String> calls = [];
  int attempts = 0;

  List<String> get types => [for (final e in received) e['type']! as String];

  @override
  Future<List<SyncEventResult>> send(List<Map<String, Object?>> events) async {
    attempts += 1;
    if (offline) throw const NetworkFailure();
    calls.add('batch');
    received.addAll(events);
    return [
      for (final event in events)
        (id: event['id']! as String, result: _respond(event)),
    ];
  }

  ActionResult _respond(Map<String, Object?> event) {
    final type = event['type']! as String;
    final configured = responses[type];
    if (configured != null) return configured;
    final data = (event['data']! as Map).cast<String, Object?>();
    return switch (type) {
      'checklist' => ActionResult(
        SyncStatus.applied,
        result: {
          'passed': (data['items']! as List).every(
            (i) => (i as Map)['ok'] == true,
          ),
        },
      ),
      'scan' => ActionResult(
        SyncStatus.applied,
        result: {
          'result': 'ok',
          'message': 'Bienvenido, Ana.',
          'onboard': ++onboard,
        },
      ),
      _ => const ActionResult(SyncStatus.applied),
    };
  }
}

/// GPS de prueba: cada prueba empuja las lecturas que necesite (15 s entre una y otra).
class FakeLocationTracker implements LocationTracker {
  FakeLocationTracker() {
    _controller = StreamController<GpsFix>.broadcast(
      onListen: () => listening = true,
      onCancel: () => listening = false,
    );
  }

  late final StreamController<GpsFix> _controller;

  /// El GPS está encendido (alguien escucha).
  bool listening = false;
  DateTime clock = DateTime.utc(2026, 10, 5, 11, 5);

  void moveTo(
    double lat,
    double lng, {
    Duration after = const Duration(seconds: 15),
    double accuracy = 8,
  }) {
    clock = clock.add(after);
    _controller.add(
      GpsFix(
        lat: lat,
        lng: lng,
        recordedAt: clock,
        speedKmh: 32,
        accuracyM: accuracy,
      ),
    );
  }

  @override
  Stream<GpsFix> watch() => _controller.stream;
}

/// Red de prueba: empieza con señal; cada prueba la quita o la regresa.
class FakeConnectivity implements ConnectivityMonitor {
  final _controller = StreamController<bool>.broadcast();
  bool online = true;

  void set(bool value) {
    online = value;
    _controller.add(value);
  }

  @override
  Future<bool> isOnline() async => online;

  @override
  Stream<bool> get changes => _controller.stream;
}

class FakeRealtimeClient implements RealtimeClient {
  final controller = StreamController<RealtimeEvent>.broadcast();
  String? token;

  @override
  Stream<RealtimeEvent> get events => controller.stream;

  @override
  void connect(String accessToken) => token = accessToken;

  @override
  void disconnect() => token = null;
}

Future<ProviderContainer> pumpApp(
  WidgetTester tester, {
  required InMemoryCredentialStore store,
  required FakeAuthRepository repository,
  String environment = 'dev',
  FakeDeviceProbe? probe,
  FakeDeviceFixer? fixer,
  FakeDeviceHealthApi? healthApi,
  FakeTripRepository? trips,
  FakeSyncApi? sync,
  FakeRealtimeClient? realtime,
  FakeLocationTracker? location,
  FakeConnectivity? connectivity,
  AppDatabase? database,
}) async {
  final deviceProbe = probe ?? FakeDeviceProbe();
  // Con [database] la prueba maneja la base (por ejemplo, para simular un reinicio).
  final db = database ?? AppDatabase(NativeDatabase.memory());
  if (database == null) addTearDown(db.close);
  final container = ProviderContainer(
    // Sin reintentos automáticos de Riverpod (dejarían temporizadores pendientes).
    retry: (_, _) => null,
    overrides: [
      appConfigProvider.overrideWithValue(
        AppConfig.fromValues(environment: environment),
      ),
      appDatabaseProvider.overrideWithValue(db),
      credentialStoreProvider.overrideWithValue(store),
      authRepositoryProvider.overrideWithValue(repository),
      qrScannerProvider.overrideWithValue(fakeScanner),
      deviceProbeProvider.overrideWithValue(deviceProbe),
      deviceFixerProvider.overrideWithValue(
        fixer ?? FakeDeviceFixer(deviceProbe),
      ),
      deviceHealthApiProvider.overrideWithValue(
        healthApi ?? FakeDeviceHealthApi(),
      ),
      tripRepositoryProvider.overrideWithValue(trips ?? FakeTripRepository()),
      syncApiProvider.overrideWithValue(sync ?? FakeSyncApi()),
      realtimeClientProvider.overrideWithValue(
        realtime ?? FakeRealtimeClient(),
      ),
      mapTilesEnabledProvider.overrideWithValue(false),
      locationTrackerProvider.overrideWithValue(
        location ?? FakeLocationTracker(),
      ),
      connectivityMonitorProvider.overrideWithValue(
        connectivity ?? FakeConnectivity(),
      ),
      photoCaptureProvider.overrideWithValue(
        () async => (bytes: <int>[1, 2, 3], name: 'foto.jpg'),
      ),
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
