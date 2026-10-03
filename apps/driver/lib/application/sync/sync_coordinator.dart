import 'dart:async';
import 'dart:math' as math;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/logging/app_logger.dart';
import '../../data/sync/connectivity_monitor.dart';
import '../auth/auth_controller.dart';
import '../auth/auth_providers.dart';
import '../providers.dart';
import '../trips/trip_providers.dart';
import '../trips/trips_controller.dart';
import 'sync_service.dart';

final connectivityMonitorProvider = Provider<ConnectivityMonitor>(
  (ref) => PluginConnectivityMonitor(),
);

class SyncState {
  const SyncState({this.pending = 0, this.offline = false, this.lastSyncAt});

  /// Eventos guardados que faltan por enviar.
  final int pending;

  /// Sin red o sin respuesta del servidor: se muestra «Sin señal».
  final bool offline;
  final DateTime? lastSyncAt;
}

/// Decide cuándo enviar la cola: en cuanto se registra algo, al recuperar la red, al volver
/// a la app y con reintentos cada vez más espaciados (5 s hasta 2 min) mientras quede algo.
class SyncCoordinator extends Notifier<SyncState> {
  final _log = appLogger('sync');
  StreamSubscription<bool>? _connectivity;
  Timer? _retry;
  int _failures = 0;
  bool _networkUp = true;

  static const _maxRetryDelay = Duration(minutes: 2);

  @override
  SyncState build() {
    ref.onDispose(stop);
    return const SyncState();
  }

  /// Empieza a vigilar la red (una vez, al abrir la app).
  Future<void> start() async {
    if (_connectivity != null) return;
    final monitor = ref.read(connectivityMonitorProvider);
    _connectivity = monitor.changes.listen(_onConnectivity);
    _networkUp = await monitor.isOnline();
    if (!ref.mounted) return;
    state = SyncState(
      pending: await ref.read(outboxRepositoryProvider).pendingCount(),
      offline: !_networkUp,
      lastSyncAt: state.lastSyncAt,
    );
    if (_networkUp) unawaited(syncNow());
  }

  void stop() {
    _connectivity?.cancel();
    _connectivity = null;
    _retry?.cancel();
    _retry = null;
  }

  void _onConnectivity(bool online) {
    _networkUp = online;
    if (online) {
      _failures = 0;
      unawaited(syncNow());
    } else {
      state = SyncState(
        pending: state.pending,
        offline: true,
        lastSyncAt: state.lastSyncAt,
      );
    }
  }

  /// Envía la cola ahora. Sin red solo actualiza el contador (el envío sale al volver).
  Future<SyncReport> syncNow() async {
    final outbox = ref.read(outboxRepositoryProvider);
    if (!_networkUp || ref.read(authControllerProvider) is! AuthSignedIn) {
      final pending = await outbox.pendingCount();
      if (ref.mounted) {
        state = SyncState(
          pending: pending,
          offline: !_networkUp,
          lastSyncAt: state.lastSyncAt,
        );
      }
      return SyncReport(offline: !_networkUp, pending: pending);
    }
    _retry?.cancel();
    _retry = null;
    final report = await ref.read(syncServiceProvider).flush();
    if (!ref.mounted) return report;
    if (report.autoArrivals.isNotEmpty) {
      ref
          .read(tripsControllerProvider.notifier)
          .applyServerArrivals(report.autoArrivals);
    }
    state = SyncState(
      pending: report.pending,
      offline: report.offline || !_networkUp,
      lastSyncAt: report.offline ? state.lastSyncAt : DateTime.now(),
    );
    _scheduleRetry(report);
    return report;
  }

  void _scheduleRetry(SyncReport report) {
    if (report.pending == 0) {
      _failures = 0;
      return;
    }
    // Solo con la app abierta y vigilando la red (no en pruebas sueltas).
    if (_connectivity == null || _retry != null) return;
    _failures += 1;
    final seconds = math.min(
      5 * math.pow(2, _failures - 1).toInt(),
      _maxRetryDelay.inSeconds,
    );
    _log.fine('Quedan ${report.pending} eventos; reintento en $seconds s');
    _retry = Timer(Duration(seconds: seconds), () {
      _retry = null;
      unawaited(syncNow());
    });
  }
}

final syncCoordinatorProvider = NotifierProvider<SyncCoordinator, SyncState>(
  SyncCoordinator.new,
);
