import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'application/providers.dart';
import 'core/config/environment.dart';
import 'core/logging/app_logger.dart';

void main() {
  final config = AppConfig.fromEnvironment();
  setupLogging(config);
  final log = appLogger('app');
  // Los errores no atrapados se registran (para el botón «Tengo un problema»).
  FlutterError.onError = (details) {
    log.severe('Error de Flutter', details.exception, details.stack);
  };
  runZonedGuarded(
    () => runApp(
      ProviderScope(
        overrides: [appConfigProvider.overrideWithValue(config)],
        child: const ShiftlaneDriverApp(),
      ),
    ),
    (error, stack) => log.severe('Error no atrapado', error, stack),
  );
}
