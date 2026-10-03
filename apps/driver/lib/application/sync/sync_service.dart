import 'dart:async';

import '../../core/errors/app_failure.dart';
import '../../core/logging/app_logger.dart';
import '../../data/sync/sync_api.dart';
import '../../domain/outbox/outbox_event.dart';
import '../../domain/trips/trip_models.dart';

/// Envía la cola local al servidor en orden. Lo aplicado, repetido o rechazado sale de la
/// cola; lo que no se pudo enviar (sin señal) o el servidor pide reintentar se queda.
class SyncService {
  SyncService({required this.outbox, required this.api});

  final OutboxRepository outbox;
  final SyncApi api;
  final _log = appLogger('sync');
  Future<Map<String, ActionResult>>? _running;

  /// Una sola sincronización a la vez: si ya hay una, se espera y se vuelve a intentar.
  Future<Map<String, ActionResult>> flush() async {
    while (_running != null) {
      await _running;
    }
    final run = _flush();
    _running = run;
    try {
      return await run;
    } finally {
      _running = null;
    }
  }

  Future<Map<String, ActionResult>> _flush() async {
    final pending = await outbox.pending(limit: 500);
    if (pending.isEmpty) return const {};
    try {
      final results = await api.send(
        pending.map((e) => e.toSyncJson()).toList(),
      );
      final processed = <String>[];
      final retry = <String>[];
      final byId = <String, ActionResult>{};
      for (final (:id, :result) in results) {
        byId[id] = result;
        if (result.status == SyncStatus.retry) {
          retry.add(id);
        } else {
          processed.add(id);
        }
      }
      if (processed.isNotEmpty) await outbox.markSent(processed);
      if (retry.isNotEmpty) {
        await outbox.markFailed(retry, 'El servidor pidió reintentar');
      }
      return byId;
    } on NetworkFailure catch (failure) {
      _log.info('Sin señal: ${pending.length} eventos guardados para después');
      await outbox.markFailed(pending.map((e) => e.id), failure.message);
      return {
        for (final event in pending)
          event.id: const ActionResult(SyncStatus.queued),
      };
    } on AppFailure catch (failure) {
      _log.warning('No se pudo sincronizar: ${failure.message}');
      await outbox.markFailed(pending.map((e) => e.id), failure.message);
      return {
        for (final event in pending)
          event.id: ActionResult(SyncStatus.queued, message: failure.message),
      };
    }
  }
}
