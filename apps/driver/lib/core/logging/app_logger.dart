import 'dart:collection';
import 'dart:developer' as developer;

import 'package:logging/logging.dart';

import '../config/environment.dart';

/// Últimos registros en memoria: se adjuntan cuando el chofer reporta un problema.
class LogBuffer {
  LogBuffer({this.capacity = 500});

  final int capacity;
  final Queue<LogRecord> _records = Queue<LogRecord>();

  void add(LogRecord record) {
    _records.addLast(record);
    while (_records.length > capacity) {
      _records.removeFirst();
    }
  }

  List<LogRecord> get records => List.unmodifiable(_records);

  /// Texto para enviar a soporte (sin datos personales: solo nivel, origen y mensaje).
  String export() => _records
      .map(
        (r) =>
            '${r.time.toIso8601String()} ${r.level.name} ${r.loggerName}: ${r.message}',
      )
      .join('\n');
}

final LogBuffer logBuffer = LogBuffer();

/// Configura los registros: en producción solo avisos y errores.
void setupLogging(AppConfig config) {
  Logger.root.level = config.isProduction ? Level.WARNING : Level.ALL;
  Logger.root.onRecord.listen((record) {
    logBuffer.add(record);
    developer.log(
      record.message,
      time: record.time,
      level: record.level.value,
      name: record.loggerName,
      error: record.error,
      stackTrace: record.stackTrace,
    );
  });
}

Logger appLogger(String name) => Logger('shiftlane.$name');
