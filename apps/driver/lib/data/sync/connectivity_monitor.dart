import 'package:connectivity_plus/connectivity_plus.dart';

/// ¿El celular tiene alguna red? (No garantiza llegar al servidor: eso lo dice el envío.)
abstract interface class ConnectivityMonitor {
  Future<bool> isOnline();

  /// Cambios de red: true al recuperar datos o wifi, false al perderlos.
  Stream<bool> get changes;
}

class PluginConnectivityMonitor implements ConnectivityMonitor {
  final _connectivity = Connectivity();

  static bool _online(List<ConnectivityResult> results) =>
      results.any((r) => r != ConnectivityResult.none);

  @override
  Future<bool> isOnline() async =>
      _online(await _connectivity.checkConnectivity());

  @override
  Stream<bool> get changes =>
      _connectivity.onConnectivityChanged.map(_online).distinct();
}
