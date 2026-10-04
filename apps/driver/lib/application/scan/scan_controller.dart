import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/app_failure.dart';
import '../../core/logging/app_logger.dart';
import '../../data/scan/audio_scan_feedback.dart';
import '../../data/scan/manifest_repository.dart';
import '../../domain/scan/local_validator.dart';
import '../../domain/scan/scan_models.dart';
import '../../domain/trips/stop_notice.dart';
import '../../domain/trips/trip_models.dart';
import '../../presentation/widgets/code_scanner_view.dart';
import '../providers.dart';
import '../tracking/trip_tracking.dart';
import '../trips/trips_controller.dart';

/// Cámara para escanear pasajeros (en pruebas se reemplaza por un botón).
typedef CodeScannerBuilder = Widget Function(
  BuildContext context,
  ValueChanged<ScannedCode> onCode,
);

final codeScannerProvider = Provider<CodeScannerBuilder>(
  (ref) =>
      (context, onCode) => CodeScannerView(onCode: onCode),
);

final scanFeedbackProvider = Provider<ScanFeedback>(
  (ref) => AudioScanFeedback(),
);

final manifestApiProvider = Provider<ManifestApi>(
  (ref) => ManifestApi(ref.watch(apiClientProvider)),
);

final manifestStoreProvider = Provider<ManifestStore>(
  (ref) => ManifestStore(ref.watch(appDatabaseProvider)),
);

/// Lista de la planta del viaje: del servidor (y se guarda) o, sin señal, la guardada.
/// null si nunca se pudo descargar: entonces valida solo el servidor.
final manifestProvider = FutureProvider.family<TripManifest?, String>((
  ref,
  tripId,
) async {
  final store = ref.read(manifestStoreProvider);
  try {
    final manifest = await ref.read(manifestApiProvider).fetch(tripId);
    await store.save(manifest);
    return manifest;
  } on AppFailure catch (failure) {
    appLogger('scan').info('Lista guardada del viaje: ${failure.message}');
    return store.load(tripId);
  }
});

/// Lo que ve el chofer después de escanear.
class ScanView {
  const ScanView({
    required this.message,
    this.outcome,
    this.passengerName,
    this.stopName,
    this.confirmed = false,
    this.queued = false,
  });

  /// null: sin lista en el celular y sin señal (se valida al sincronizar).
  final ScanOutcome? outcome;
  final String message;
  final String? passengerName;
  final String? stopName;

  /// El servidor ya respondió (su resultado manda).
  final bool confirmed;

  /// Quedó guardado sin señal.
  final bool queued;
}

/// Escaneo de pasajeros: primero se valida en el celular contra la lista descargada (sonido y
/// vibración al instante, con o sin señal); luego se envía y, si el servidor responde algo
/// distinto, se corrige en pantalla con su sonido.
class ScanController extends Notifier<ScanView?> {
  @override
  ScanView? build() => null;

  void clear() => state = null;

  Future<ScanView?> scan(
    DriverTrip trip, {
    ScannedCode? code,
    String? employeeNumber,
  }) async {
    final store = ref.read(manifestStoreProvider);
    final feedback = ref.read(scanFeedbackProvider);
    final manifest = await ref.read(manifestProvider(trip.id).future);
    final local = manifest == null
        ? null
        : validateLocally(
            manifest,
            code: code?.value,
            employeeNumber: employeeNumber,
            scannedHere: await store.scanned(trip.id),
          );
    final stop = nearestStop(trip, ref.read(positionProvider));

    if (local != null) {
      unawaited(feedback.play(local.outcome));
      state = ScanView(
        outcome: local.outcome,
        message: local.message,
        passengerName: local.passenger?.name,
        stopName: local.outcome.boards ? stop?.name : null,
      );
      // Ya subió: no hace falta registrarlo otra vez.
      if (local.outcome == ScanOutcome.alreadyScanned) return state;
      if (local.passenger != null && local.outcome.boards) {
        await store.markScanned(trip.id, local.passenger!.id);
      }
    }

    final result = await ref
        .read(tripsControllerProvider.notifier)
        .scan(
          trip.id,
          code: code?.value,
          codeType: code == null ? null : (code.isQr ? 'qr' : 'barcode'),
          employeeNumber: employeeNumber,
          countsOnboard: local?.outcome.boards,
        );
    if (!ref.mounted) return null;
    if (manifest == null) ref.invalidate(manifestProvider(trip.id));

    final server = scanOutcomeFrom(result.result?['result'] as String?);
    if (server != null) {
      if (server != local?.outcome) unawaited(feedback.play(server));
      final passenger = result.result?['passenger'] as Map<String, dynamic>?;
      final serverStop = result.result?['stop'] as Map<String, dynamic>?;
      state = ScanView(
        outcome: server,
        message: result.result!['message'] as String? ?? local?.message ?? '',
        passengerName:
            local?.passenger?.name ??
            (passenger?['fullName'] as String?)?.split(' ').first,
        stopName: serverStop?['name'] as String? ?? state?.stopName,
        confirmed: true,
      );
    } else if (result.status == SyncStatus.queued ||
        result.status == SyncStatus.retry) {
      state = ScanView(
        outcome: local?.outcome,
        message: local?.message ?? 'Sin señal: el escaneo quedó guardado.',
        passengerName: local?.passenger?.name,
        stopName: state?.stopName,
        queued: true,
      );
    } else if (!result.accepted) {
      unawaited(feedback.play(ScanOutcome.rejected));
      state = ScanView(
        outcome: ScanOutcome.rejected,
        message: result.message ?? 'No se pudo registrar el escaneo.',
        confirmed: true,
      );
    }
    return state;
  }
}

final scanControllerProvider = NotifierProvider<ScanController, ScanView?>(
  ScanController.new,
);
