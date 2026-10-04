import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/services.dart';

import '../../core/logging/app_logger.dart';
import '../../domain/scan/scan_models.dart';

/// Sonido y vibración del escaneo: cada resultado suena y vibra distinto para que el chofer
/// sepa qué pasó sin mirar la pantalla.
abstract interface class ScanFeedback {
  Future<void> play(ScanOutcome outcome);
}

class AudioScanFeedback implements ScanFeedback {
  final _players = <ScanOutcome, AudioPlayer>{};
  final _log = appLogger('scan');

  static String _asset(ScanOutcome outcome) => switch (outcome) {
    ScanOutcome.ok => 'sounds/scan_ok.wav',
    ScanOutcome.otherRoute => 'sounds/scan_other_route.wav',
    ScanOutcome.unregistered => 'sounds/scan_unregistered.wav',
    ScanOutcome.alreadyScanned => 'sounds/scan_already_scanned.wav',
    ScanOutcome.rejected => 'sounds/scan_rejected.wav',
  };

  @override
  Future<void> play(ScanOutcome outcome) async {
    unawaited(_vibrate(outcome));
    try {
      var player = _players[outcome];
      if (player == null) {
        player = _players[outcome] = AudioPlayer();
        await player.setReleaseMode(ReleaseMode.stop);
      }
      await player.stop();
      await player.play(AssetSource(_asset(outcome)));
    } on Object catch (error) {
      // Sin sonido el escaneo sigue (queda la vibración y la pantalla).
      _log.warning('No se pudo reproducir el sonido: $error');
    }
  }

  static Future<void> _pause(int ms) =>
      Future<void>.delayed(Duration(milliseconds: ms));

  static Future<void> _vibrate(ScanOutcome outcome) async {
    switch (outcome) {
      case ScanOutcome.ok:
        await HapticFeedback.lightImpact();
      case ScanOutcome.otherRoute:
        await HapticFeedback.mediumImpact();
        await _pause(160);
        await HapticFeedback.mediumImpact();
      case ScanOutcome.unregistered:
        await HapticFeedback.heavyImpact();
        await _pause(220);
        await HapticFeedback.heavyImpact();
      case ScanOutcome.alreadyScanned:
        for (var i = 0; i < 3; i++) {
          await HapticFeedback.selectionClick();
          await _pause(90);
        }
      case ScanOutcome.rejected:
        await HapticFeedback.vibrate();
    }
  }
}
