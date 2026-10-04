import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/logging/app_logger.dart';
import '../../data/app_version/app_version_api.dart';
import '../../domain/app_version/app_version.dart';
import '../../domain/trips/trip_models.dart';
import '../providers.dart';
import '../trips/trips_controller.dart';

final appVersionApiProvider = Provider<AppVersionApi>(
  (ref) => AppVersionApi(ref.watch(apiClientProvider)),
);

/// Versión instalada (en pruebas se reemplaza).
final currentAppVersionProvider = FutureProvider<String>(
  (ref) async => (await PackageInfo.fromPlatform()).version,
);

/// Abre un enlace fuera de la app (descarga del APK).
final urlOpenerProvider = Provider<Future<bool> Function(Uri)>(
  (ref) =>
      (uri) => launchUrl(uri, mode: LaunchMode.externalApplication),
);

class UpdateState {
  const UpdateState({this.level = UpdateLevel.none, this.current, this.info});

  final UpdateLevel level;
  final String? current;
  final AppVersionInfo? info;
}

/// Revisa al abrir y al volver a la app si hay una versión nueva u obligatoria.
class UpdateController extends Notifier<UpdateState> {
  final _log = appLogger('update');

  @override
  UpdateState build() => const UpdateState();

  Future<void> check() async {
    try {
      final current = await ref.read(currentAppVersionProvider.future);
      final info = await ref.read(appVersionApiProvider).fetch();
      if (!ref.mounted) return;
      state = UpdateState(
        level: updateLevelFor(current, info),
        current: current,
        info: info,
      );
    } on Object catch (error) {
      // Sin señal se queda lo último que se supo.
      _log.info('No se pudo revisar la versión: $error');
    }
  }
}

final updateControllerProvider =
    NotifierProvider<UpdateController, UpdateState>(UpdateController.new);

/// La app se bloquea para actualizar, pero nunca a mitad de un viaje: primero se termina.
final mustUpdateProvider = Provider<bool>(
  (ref) =>
      ref.watch(updateControllerProvider).level == UpdateLevel.required &&
      ref.watch(currentTripProvider)?.status != TripStatus.inProgress,
);
