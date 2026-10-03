import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config/environment.dart';
import '../core/network/api_client.dart';
import '../data/local/app_database.dart';
import '../data/outbox/drift_outbox_repository.dart';
import '../domain/outbox/outbox_event.dart';
import 'auth/auth_providers.dart';
import 'outbox/outbox_service.dart';

/// Configuración del ambiente (se reemplaza en main y en las pruebas).
final appConfigProvider = Provider<AppConfig>(
  (ref) => AppConfig.fromEnvironment(),
);

final appDatabaseProvider = Provider<AppDatabase>((ref) {
  final db = AppDatabase();
  ref.onDispose(db.close);
  return db;
});

/// Token de acceso vigente; lo llena el inicio de sesión (F07-P02).
class AccessToken extends Notifier<String?> {
  @override
  String? build() => null;

  void set(String? token) => state = token;
}

final accessTokenProvider = NotifierProvider<AccessToken, String?>(
  AccessToken.new,
);

final apiClientProvider = Provider<ApiClient>((ref) {
  final config = ref.watch(appConfigProvider);
  return ApiClient.create(
    config,
    readToken: () async => ref.read(accessTokenProvider),
    refreshToken: () =>
        ref.read(authControllerProvider.notifier).refreshAccessToken(),
  );
});

final outboxRepositoryProvider = Provider<OutboxRepository>(
  (ref) => DriftOutboxRepository(ref.watch(appDatabaseProvider)),
);

final outboxServiceProvider = Provider<OutboxService>(
  (ref) => OutboxService(ref.watch(outboxRepositoryProvider)),
);
