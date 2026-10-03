import 'package:dio/dio.dart';

import '../config/environment.dart';
import '../errors/app_failure.dart';
import '../logging/app_logger.dart';

/// Lee el token de acceso vigente (null si no hay sesión).
typedef TokenReader = Future<String?> Function();

/// Renueva la sesión y devuelve el token nuevo (null si no se pudo).
typedef TokenRefresher = Future<String?> Function();

/// Cliente de la API de Shiftlane: agrega el token, registra y traduce los errores. Si el
/// token venció (401), renueva la sesión una vez y repite la petición.
class ApiClient {
  ApiClient(this.dio);

  factory ApiClient.create(
    AppConfig config, {
    TokenReader? readToken,
    TokenRefresher? refreshToken,
    HttpClientAdapter? adapter,
  }) {
    final dio = Dio(
      BaseOptions(
        baseUrl: config.apiBaseUrl.toString(),
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 20),
        sendTimeout: const Duration(seconds: 20),
        contentType: 'application/json',
        responseType: ResponseType.json,
      ),
    );
    if (adapter != null) dio.httpClientAdapter = adapter;
    final log = appLogger('api');
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await readToken?.call();
          if (token != null) options.headers['authorization'] = 'Bearer $token';
          handler.next(options);
        },
        onError: (error, handler) async {
          final options = error.requestOptions;
          log.warning(
            '${options.method} ${options.path} → '
            '${error.response?.statusCode ?? error.type.name}',
          );
          final expired =
              error.response?.statusCode == 401 &&
              refreshToken != null &&
              options.extra['retried'] != true &&
              !options.path.startsWith('/auth/');
          if (!expired) return handler.next(error);
          final token = await refreshToken();
          // Un formulario con archivo no se puede reenviar: el siguiente intento ya lleva
          // el token nuevo.
          if (token == null || options.data is FormData) {
            return handler.next(error);
          }
          try {
            final retried = await dio.fetch<dynamic>(
              options.copyWith(
                headers: {...options.headers, 'authorization': 'Bearer $token'},
                extra: {...options.extra, 'retried': true},
              ),
            );
            handler.resolve(retried);
          } on DioException catch (retryError) {
            handler.next(retryError);
          }
        },
      ),
    );
    return ApiClient(dio);
  }

  final Dio dio;

  Future<T> get<T>(String path, {Map<String, dynamic>? query}) =>
      _send(() => dio.get<T>(path, queryParameters: query));

  Future<T> post<T>(String path, {Object? body}) =>
      _send(() => dio.post<T>(path, data: body));

  Future<T> put<T>(String path, {Object? body}) =>
      _send(() => dio.put<T>(path, data: body));

  Future<T> _send<T>(Future<Response<T>> Function() request) async {
    try {
      final response = await request();
      return response.data as T;
    } on DioException catch (error) {
      throw failureFromDio(error);
    }
  }
}
