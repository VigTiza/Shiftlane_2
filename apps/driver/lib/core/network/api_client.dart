import 'package:dio/dio.dart';

import '../config/environment.dart';
import '../errors/app_failure.dart';
import '../logging/app_logger.dart';

/// Lee el token de acceso vigente (null si no hay sesión).
typedef TokenReader = Future<String?> Function();

/// Cliente de la API de Shiftlane: agrega el token, registra y traduce los errores.
class ApiClient {
  ApiClient(this.dio);

  factory ApiClient.create(AppConfig config, {TokenReader? readToken}) {
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
    final log = appLogger('api');
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await readToken?.call();
          if (token != null) options.headers['authorization'] = 'Bearer $token';
          handler.next(options);
        },
        onError: (error, handler) {
          log.warning(
            '${error.requestOptions.method} ${error.requestOptions.path} → '
            '${error.response?.statusCode ?? error.type.name}',
          );
          handler.next(error);
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
