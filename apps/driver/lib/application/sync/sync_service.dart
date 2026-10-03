import 'dart:async';

import '../../core/errors/app_failure.dart';
import '../../core/logging/app_logger.dart';
import '../../data/sync/sync_api.dart';
import '../../domain/outbox/outbox_event.dart';
import '../../domain/trips/trip_models.dart';

/// Resultado de una sincronización.
class SyncReport {
  const SyncReport({
    this.results = const {},
    this.offline = false,
    this.autoArrivals = const [],
    this.pending = 0,
  });

  /// Respuesta del servidor por cada acción enviada (por UUID del evento).
  final Map<String, ActionResult> results;

  /// No hubo conexión con el servidor: todo sigue guardado.
  final bool offline;

  /// Paradas a las que el servidor detectó la llegada con las posiciones.
  final List<AutoArrival> autoArrivals;

  /// Eventos que siguen en la cola.
  final int pending;
}

enum _Round { progress, stalled, offline }

/// Envía la cola local al servidor en orden: primero las acciones por `/sync/batch` (el
/// inicio del viaje debe llegar antes que sus posiciones) y luego las posiciones en lote por
/// `/driver/positions`. Lo aplicado, repetido o rechazado sale de la cola; lo que no se pudo
/// enviar (sin señal) o el servidor pide reintentar se queda. El UUID de cada evento evita
/// duplicados aunque un lote se envíe dos veces.
class SyncService {
  SyncService({required this.outbox, required this.api});

  final OutboxRepository outbox;
  final SyncApi api;
  final _log = appLogger('sync');
  Future<SyncReport>? _running;

  /// Lotes por sincronización (el resto sale en la siguiente).
  static const _maxRounds = 10;

  /// Intentos fallidos de un lote de posiciones antes de descartarlo (datos que el servidor
  /// nunca aceptará no deben atorar la cola).
  static const maxPositionAttempts = 5;

  /// Una sola sincronización a la vez: si ya hay una, se espera y se vuelve a intentar.
  Future<SyncReport> flush() async {
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

  Future<SyncReport> _flush() async {
    final results = <String, ActionResult>{};
    final arrivals = <AutoArrival>[];
    var offline = false;

    for (var round = 0; round < _maxRounds; round++) {
      final actions = await outbox.pending(
        limit: maxSyncEvents,
        positions: false,
      );
      if (actions.isEmpty) break;
      final outcome = await _sendActions(actions, results);
      offline = outcome == _Round.offline;
      if (outcome != _Round.progress || actions.length < maxSyncEvents) break;
    }
    if (!offline) {
      for (var round = 0; round < _maxRounds; round++) {
        final points = await outbox.pending(
          limit: maxPositions,
          positions: true,
        );
        if (points.isEmpty) break;
        final outcome = await _sendPositions(points, arrivals);
        offline = outcome == _Round.offline;
        if (outcome != _Round.progress || points.length < maxPositions) break;
      }
    }
    return SyncReport(
      results: results,
      offline: offline,
      autoArrivals: arrivals,
      pending: await outbox.pendingCount(),
    );
  }

  Future<_Round> _sendActions(
    List<OutboxEvent> pending,
    Map<String, ActionResult> results,
  ) async {
    try {
      final sent = await api.send(pending.map((e) => e.toSyncJson()).toList());
      final processed = <String>[];
      final retry = <String>[];
      for (final (:id, :result) in sent) {
        results[id] = result;
        (result.status == SyncStatus.retry ? retry : processed).add(id);
      }
      if (processed.isNotEmpty) await outbox.markSent(processed);
      if (retry.isNotEmpty) {
        await outbox.markFailed(retry, 'El servidor pidió reintentar');
      }
      return processed.isEmpty ? _Round.stalled : _Round.progress;
    } on NetworkFailure catch (failure) {
      _log.info('Sin señal: ${pending.length} acciones guardadas para después');
      await outbox.markFailed(pending.map((e) => e.id), failure.message);
      for (final event in pending) {
        results[event.id] = const ActionResult(SyncStatus.queued);
      }
      return _Round.offline;
    } on AppFailure catch (failure) {
      _log.warning('No se pudo sincronizar: ${failure.message}');
      await outbox.markFailed(pending.map((e) => e.id), failure.message);
      for (final event in pending) {
        results[event.id] = ActionResult(
          SyncStatus.queued,
          message: failure.message,
        );
      }
      return _Round.stalled;
    }
  }

  Future<_Round> _sendPositions(
    List<OutboxEvent> pending,
    List<AutoArrival> arrivals,
  ) async {
    try {
      final receipt = await api.sendPositions([
        for (final event in pending) event.data,
      ]);
      await outbox.markSent(pending.map((e) => e.id));
      arrivals.addAll(receipt.autoArrivals);
      return _Round.progress;
    } on NetworkFailure catch (failure) {
      await outbox.markFailed(pending.map((e) => e.id), failure.message);
      return _Round.offline;
    } on AppFailure catch (failure) {
      _log.warning('No se pudieron enviar posiciones: ${failure.message}');
      await outbox.markFailed(pending.map((e) => e.id), failure.message);
      final exhausted = [
        for (final event in pending)
          if (event.attempts + 1 >= maxPositionAttempts) event.id,
      ];
      if (exhausted.isNotEmpty) {
        _log.severe('Se descartan ${exhausted.length} posiciones sin aceptar');
        await outbox.markSent(exhausted);
      }
      return _Round.stalled;
    }
  }
}
