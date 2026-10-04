/// Compara versiones «1.2.10» por número (−1, 0 o 1). Lo que no es número cuenta como 0.
int compareVersions(String a, String b) {
  List<int> parts(String v) =>
      v.split('+').first.split('.').map((p) => int.tryParse(p) ?? 0).toList();
  final x = parts(a);
  final y = parts(b);
  for (var i = 0; i < x.length || i < y.length; i++) {
    final left = i < x.length ? x[i] : 0;
    final right = i < y.length ? y[i] : 0;
    if (left != right) return left < right ? -1 : 1;
  }
  return 0;
}

/// Lo que dice el servidor sobre las versiones de la app (GET /driver/app-version).
class AppVersionInfo {
  const AppVersionInfo({this.minVersion, this.latestVersion, this.downloadUrl});

  factory AppVersionInfo.fromJson(Map<String, dynamic> json) => AppVersionInfo(
    minVersion: json['minVersion'] as String?,
    latestVersion: json['latestVersion'] as String?,
    downloadUrl: json['downloadUrl'] as String?,
  );

  final String? minVersion;
  final String? latestVersion;
  final String? downloadUrl;
}

enum UpdateLevel { none, suggested, required }

UpdateLevel updateLevelFor(String current, AppVersionInfo info) {
  if (info.minVersion != null &&
      compareVersions(current, info.minVersion!) < 0) {
    return UpdateLevel.required;
  }
  if (info.latestVersion != null &&
      compareVersions(current, info.latestVersion!) < 0) {
    return UpdateLevel.suggested;
  }
  return UpdateLevel.none;
}
