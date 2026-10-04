import 'app_database.dart';

/// Marcas simples guardadas en el celular (por ejemplo, «ya vio el tutorial»).
class LocalFlags {
  LocalFlags(this._db);

  final AppDatabase _db;

  static String _key(String name) => 'flag:$name';

  Future<bool> isSet(String name) async =>
      await (_db.select(
        _db.snapshots,
      )..where((s) => s.key.equals(_key(name)))).getSingleOrNull() !=
      null;

  Future<void> set(String name) => _db
      .into(_db.snapshots)
      .insertOnConflictUpdate(
        SnapshotsCompanion.insert(
          key: _key(name),
          payload: 'true',
          savedAt: DateTime.now(),
        ),
      );

  Future<void> clear(String name) =>
      (_db.delete(_db.snapshots)..where((s) => s.key.equals(_key(name)))).go();
}
