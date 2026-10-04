import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/local/local_flags.dart';
import '../auth/auth_controller.dart';
import '../auth/auth_providers.dart';
import '../providers.dart';

final localFlagsProvider = Provider<LocalFlags>(
  (ref) => LocalFlags(ref.watch(appDatabaseProvider)),
);

/// ¿El chofer con sesión ya vio el tutorial? (null mientras se lee). Cada chofer lo ve la
/// primera vez que entra, aunque el celular sea compartido.
class TutorialController extends Notifier<bool?> {
  String? _driverId;

  String _flag(String driverId) => 'tutorial_seen:$driverId';

  @override
  bool? build() {
    _driverId = ref.watch(
      authControllerProvider.select(
        (auth) => auth is AuthSignedIn ? auth.session.driverId : null,
      ),
    );
    final driverId = _driverId;
    if (driverId == null) return null;
    Future.microtask(() async {
      final seen = await ref.read(localFlagsProvider).isSet(_flag(driverId));
      if (ref.mounted && _driverId == driverId) state = seen;
    });
    return null;
  }

  Future<void> markSeen() async {
    final driverId = _driverId;
    if (driverId == null) return;
    await ref.read(localFlagsProvider).set(_flag(driverId));
    if (ref.mounted) state = true;
  }
}

final tutorialControllerProvider = NotifierProvider<TutorialController, bool?>(
  TutorialController.new,
);
