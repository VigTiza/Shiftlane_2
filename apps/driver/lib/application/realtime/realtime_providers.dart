import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/realtime/socket_realtime_client.dart';
import '../auth/auth_controller.dart';
import '../auth/auth_providers.dart';
import '../providers.dart';

final realtimeClientProvider = Provider<RealtimeClient>((ref) {
  final client = SocketRealtimeClient(
    ref.watch(appConfigProvider).apiBaseUrl.toString(),
  );
  ref.onDispose(client.disconnect);
  return client;
});

/// Eventos en tiempo real del chofer: se conecta mientras hay sesión con token.
final realtimeEventsProvider = StreamProvider<RealtimeEvent>((ref) {
  final client = ref.watch(realtimeClientProvider);
  final auth = ref.watch(authControllerProvider);
  if (auth is AuthSignedIn && auth.session.accessToken.isNotEmpty) {
    client.connect(auth.session.accessToken);
  } else {
    client.disconnect();
  }
  return client.events;
});
