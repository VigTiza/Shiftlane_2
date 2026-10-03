import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shiftlane_driver/core/config/environment.dart';
import 'package:shiftlane_driver/core/errors/app_failure.dart';
import 'package:shiftlane_driver/core/logging/app_logger.dart';
import 'package:shiftlane_driver/core/network/api_client.dart';
import 'package:shiftlane_driver/core/theme/app_theme.dart';
import 'package:logging/logging.dart';

DioException _response(int status, [Object? data]) {
  final options = RequestOptions(path: '/x');
  return DioException.badResponse(
    statusCode: status,
    requestOptions: options,
    response: Response<Object?>(
      requestOptions: options,
      statusCode: status,
      data: data,
    ),
  );
}

void main() {
  group('ambientes', () {
    test('cada ambiente tiene su URL por omisión', () {
      expect(
        AppConfig.fromValues(environment: 'dev').apiBaseUrl.toString(),
        'http://10.0.2.2:3000',
      );
      expect(
        AppConfig.fromValues(environment: 'staging').apiBaseUrl.host,
        'api.staging.shiftlane.mx',
      );
      final prod = AppConfig.fromValues(environment: 'prod');
      expect(prod.isProduction, isTrue);
      expect(prod.label, isEmpty);
    });

    test('se puede cambiar la URL y el intervalo queda entre 10 y 15 s', () {
      final config = AppConfig.fromValues(
        environment: 'dev',
        apiUrl: 'http://192.168.1.50:3000',
        locationInterval: '30',
      );
      expect(config.apiBaseUrl.host, '192.168.1.50');
      expect(config.locationIntervalSeconds, 15);
      expect(
        AppConfig.fromValues(locationInterval: '3').locationIntervalSeconds,
        10,
      );
    });

    test('rechaza ambientes y URLs inválidos', () {
      expect(
        () => AppConfig.fromValues(environment: 'qa'),
        throwsArgumentError,
      );
      expect(
        () => AppConfig.fromValues(apiUrl: 'no-es-url'),
        throwsArgumentError,
      );
    });
  });

  group('errores de la API en español', () {
    test('sin conexión', () {
      final failure = failureFromDio(
        DioException.connectionError(
          requestOptions: RequestOptions(path: '/x'),
          reason: 'sin red',
        ),
      );
      expect(failure, isA<NetworkFailure>());
      expect(failure.message, contains('Tus datos se guardan'));
    });

    test('usa el mensaje del servidor', () {
      final conflict = failureFromDio(
        _response(409, {
          'error': {'code': 'CONFLICT', 'message': 'El viaje ya terminó.'},
        }),
      );
      expect(conflict, isA<ConflictFailure>());
      expect(conflict.message, 'El viaje ya terminó.');

      final validation = failureFromDio(
        _response(400, {
          'error': {
            'code': 'VALIDATION_ERROR',
            'message': 'Revisa los datos.',
            'details': [
              {'path': 'pin', 'message': 'El PIN tiene 4 dígitos.'},
            ],
          },
        }),
      ) as ValidationFailure;
      expect(validation.details, ['El PIN tiene 4 dígitos.']);
    });

    test('sesión vencida y fallas del servidor', () {
      expect(failureFromDio(_response(401)), isA<UnauthorizedFailure>());
      expect(failureFromDio(_response(503)), isA<ServerFailure>());
      expect(failureFromDio(_response(404)).message, 'No se encontró.');
    });
  });

  test('el cliente agrega el token y traduce los errores', () async {
    final client = ApiClient.create(
      AppConfig.fromValues(),
      readToken: () async => 'token-123',
    );
    late RequestOptions seen;
    client.dio.httpClientAdapter = _FakeAdapter((options) {
      seen = options;
      return ResponseBody.fromString(
        '{"error":{"code":"CONFLICT","message":"Primero inicia el viaje."}}',
        409,
        headers: {
          Headers.contentTypeHeader: ['application/json'],
        },
      );
    });
    await expectLater(
      client.post<Object?>('/driver/trips/1/scan', body: {'code': 'X'}),
      throwsA(
        isA<ConflictFailure>().having(
          (f) => f.message,
          'message',
          'Primero inicia el viaje.',
        ),
      ),
    );
    expect(seen.headers['authorization'], 'Bearer token-123');
  });

  test('guarda los últimos registros para soporte', () {
    final buffer = LogBuffer(capacity: 2);
    for (final message in ['uno', 'dos', 'tres']) {
      buffer.add(LogRecord(Level.INFO, message, 'shiftlane.test'));
    }
    expect(buffer.records.map((r) => r.message), ['dos', 'tres']);
    expect(buffer.export(), contains('INFO shiftlane.test: tres'));
  });

  testWidgets('los botones miden al menos 56 px', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildShiftlaneTheme(),
        home: Scaffold(
          body: Center(
            child: FilledButton(onPressed: () {}, child: const Text('OK')),
          ),
        ),
      ),
    );
    final size = tester.getSize(find.byType(FilledButton));
    expect(size.height, greaterThanOrEqualTo(kMinButtonHeight));
  });
}

class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.respond);

  final ResponseBody Function(RequestOptions options) respond;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) async => respond(options);

  @override
  void close({bool force = false}) {}
}
