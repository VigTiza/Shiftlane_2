import 'package:dio/dio.dart';

/// Error esperado que la app sabe explicar al chofer (siempre en español).
sealed class AppFailure implements Exception {
  const AppFailure(this.message);

  final String message;

  @override
  String toString() => message;
}

/// Sin conexión o el servidor no respondió a tiempo: los datos se guardan para después.
class NetworkFailure extends AppFailure {
  const NetworkFailure([
    super.message =
        'Sin conexión con el servidor. Tus datos se guardan en el celular.',
  ]);
}

/// La sesión terminó o el token no es válido.
class UnauthorizedFailure extends AppFailure {
  const UnauthorizedFailure([
    super.message = 'Tu sesión terminó; vuelve a ingresar tu PIN.',
  ]);
}

/// Datos inválidos (400): el servidor explica qué corregir.
class ValidationFailure extends AppFailure {
  const ValidationFailure(super.message, {this.details = const []});

  final List<String> details;
}

class NotFoundFailure extends AppFailure {
  const NotFoundFailure(super.message);
}

/// La acción no se puede hacer en el estado actual (409), por ejemplo iniciar dos veces.
class ConflictFailure extends AppFailure {
  const ConflictFailure(super.message, {this.code});

  final String? code;
}

class ServerFailure extends AppFailure {
  const ServerFailure([
    super.message =
        'El servidor tuvo un problema; intenta de nuevo en un momento.',
  ]);
}

class UnknownFailure extends AppFailure {
  const UnknownFailure([super.message = 'Algo salió mal; intenta de nuevo.']);
}

/// Mensaje del cuerpo de error de la API: `{ error: { code, message, details } }`.
({String? code, String? message, List<String> details}) _errorBody(
  Object? data,
) {
  if (data is Map && data['error'] is Map) {
    final error = data['error'] as Map;
    final details = error['details'] is List
        ? (error['details'] as List)
              .whereType<Map<dynamic, dynamic>>()
              .map((d) => '${d['message'] ?? ''}')
              .where((m) => m.isNotEmpty)
              .toList()
        : <String>[];
    return (
      code: error['code'] as String?,
      message: error['message'] as String?,
      details: details,
    );
  }
  return (code: null, message: null, details: const []);
}

/// Convierte un error de red de dio en un error que la app sabe explicar.
AppFailure failureFromDio(DioException error) {
  switch (error.type) {
    case DioExceptionType.connectionError:
    case DioExceptionType.connectionTimeout:
    case DioExceptionType.sendTimeout:
    case DioExceptionType.receiveTimeout:
      return const NetworkFailure();
    case DioExceptionType.badResponse:
      final status = error.response?.statusCode ?? 0;
      final body = _errorBody(error.response?.data);
      if (status == 401) return const UnauthorizedFailure();
      if (status == 400) {
        return ValidationFailure(
          body.message ?? 'Revisa los datos.',
          details: body.details,
        );
      }
      if (status == 404) {
        return NotFoundFailure(body.message ?? 'No se encontró.');
      }
      if (status == 409) {
        return ConflictFailure(
          body.message ?? 'No se puede hacer ahora.',
          code: body.code,
        );
      }
      if (status >= 500) return const ServerFailure();
      return UnknownFailure(
        body.message ?? 'Algo salió mal; intenta de nuevo.',
      );
    case DioExceptionType.transformTimeout:
      return const NetworkFailure();
    case DioExceptionType.badCertificate:
    case DioExceptionType.cancel:
    case DioExceptionType.unknown:
      return const UnknownFailure();
  }
}
