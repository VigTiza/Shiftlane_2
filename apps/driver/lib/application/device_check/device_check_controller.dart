import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/app_failure.dart';
import '../../core/logging/app_logger.dart';
import '../../data/device_check/device_health_api.dart';
import '../../data/device_check/plugin_device_probe.dart';
import '../../domain/device_check/device_check.dart';
import '../providers.dart';

final deviceProbeProvider = Provider<DeviceProbe>((ref) => PluginDeviceProbe());
final deviceFixerProvider = Provider<DeviceFixer>((ref) => PluginDeviceFixer());
final deviceHealthApiProvider = Provider<DeviceHealthApi>(
  (ref) => DeviceHealthApi(ref.watch(apiClientProvider)),
);

class DeviceCheckState {
  const DeviceCheckState({
    this.report,
    this.running = false,
    this.acknowledged = false,
  });

  final DeviceCheckReport? report;
  final bool running;

  /// El chofer ya vio la revisión de esta sesión (puede ir al inicio).
  final bool acknowledged;

  DeviceCheckState copyWith({
    DeviceCheckReport? report,
    bool? running,
    bool? acknowledged,
  }) => DeviceCheckState(
    report: report ?? this.report,
    running: running ?? this.running,
    acknowledged: acknowledged ?? this.acknowledged,
  );
}

/// Revisa el celular, lo reporta al servidor (que confirma la hora y la versión) y guarda el
/// resultado para decidir si se puede iniciar un viaje.
class DeviceCheckController extends Notifier<DeviceCheckState> {
  final _log = appLogger('device_check');

  @override
  DeviceCheckState build() => const DeviceCheckState();

  Future<DeviceCheckReport> run() async {
    state = state.copyWith(running: true);
    final readings = await ref.read(deviceProbeProvider).read();
    var report = evaluateDevice(readings);
    state = state.copyWith(report: report);
    try {
      final issues = await ref.read(deviceHealthApiProvider).send(readings);
      report = report.withServerIssues(issues);
    } on AppFailure catch (failure) {
      // Sin señal se queda la revisión local; se reporta en la siguiente revisión.
      _log.info('No se pudo enviar la revisión: ${failure.message}');
    }
    state = state.copyWith(report: report, running: false);
    return report;
  }

  Future<DeviceCheckReport> fix(FixAction action) async {
    await ref.read(deviceFixerProvider).fix(action);
    return run();
  }

  void acknowledge() => state = state.copyWith(acknowledged: true);
}

final deviceCheckProvider =
    NotifierProvider<DeviceCheckController, DeviceCheckState>(
      DeviceCheckController.new,
    );
