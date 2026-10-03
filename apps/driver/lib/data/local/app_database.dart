import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

part 'app_database.g.dart';

/// Eventos pendientes de enviar (cola del modo sin señal).
@DataClassName('OutboxEventRow')
class OutboxEvents extends Table {
  TextColumn get id => text()();
  TextColumn get type => text()();
  IntColumn get sequence => integer()();
  DateTimeColumn get occurredAt => dateTime()();
  TextColumn get tripId => text().nullable()();

  /// Datos del evento en JSON.
  TextColumn get payload => text()();
  IntColumn get attempts => integer().withDefault(const Constant(0))();
  TextColumn get lastError => text().nullable()();
  DateTimeColumn get sentAt => dateTime().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

@DriftDatabase(tables: [OutboxEvents])
class AppDatabase extends _$AppDatabase {
  AppDatabase([QueryExecutor? executor])
    : super(executor ?? driftDatabase(name: 'shiftlane'));

  @override
  int get schemaVersion => 1;
}
