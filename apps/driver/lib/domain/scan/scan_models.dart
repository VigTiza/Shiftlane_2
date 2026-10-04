/// Resultado de escanear a un pasajero (mismos valores que la API).
enum ScanOutcome { ok, otherRoute, unregistered, alreadyScanned, rejected }

ScanOutcome? scanOutcomeFrom(String? value) => switch (value) {
  'ok' => ScanOutcome.ok,
  'other_route' => ScanOutcome.otherRoute,
  'unregistered' => ScanOutcome.unregistered,
  'already_scanned' => ScanOutcome.alreadyScanned,
  'rejected' => ScanOutcome.rejected,
  _ => null,
};

extension ScanOutcomeInfo on ScanOutcome {
  String get title => switch (this) {
    ScanOutcome.ok => 'Correcto',
    ScanOutcome.otherRoute => 'Otra ruta',
    ScanOutcome.unregistered => 'No registrado',
    ScanOutcome.alreadyScanned => 'Ya escaneado',
    ScanOutcome.rejected => 'No válido',
  };

  /// El pasajero cuenta a bordo (el servidor crea el abordaje en estos casos).
  bool get boards =>
      this == ScanOutcome.ok ||
      this == ScanOutcome.otherRoute ||
      this == ScanOutcome.unregistered;
}

/// Lo que leyó la cámara: credencial QR de Shiftlane, gafete con QR o código de barras.
class ScannedCode {
  const ScannedCode(this.value, {required this.isQr});

  final String value;
  final bool isQr;
}

class ManifestPassenger {
  const ManifestPassenger({
    required this.id,
    required this.name,
    required this.employeeNumber,
    required this.onRoute,
    required this.credentialHashes,
  });

  factory ManifestPassenger.fromJson(Map<String, dynamic> json) =>
      ManifestPassenger(
        id: json['id'] as String,
        name: json['name'] as String,
        employeeNumber: json['employeeNumber'] as String,
        onRoute: json['onRoute'] as bool,
        credentialHashes: (json['credentialHashes'] as List<dynamic>)
            .cast<String>(),
      );

  final String id;

  /// Nombre corto («Ana R.»).
  final String name;
  final String employeeNumber;
  final bool onRoute;

  /// SHA-256 (hex) de sus credenciales vigentes.
  final List<String> credentialHashes;

  String get firstName => name.split(' ').first;

  Map<String, Object?> toJson() => {
    'id': id,
    'name': name,
    'employeeNumber': employeeNumber,
    'onRoute': onRoute,
    'credentialHashes': credentialHashes,
  };
}

/// Pasajeros de la planta del viaje para validar sin señal (GET /driver/trips/:id/manifest).
class TripManifest {
  TripManifest({
    required this.tripId,
    required this.passengers,
    required this.boarded,
  }) : _byHash = {
         for (final p in passengers)
           for (final hash in p.credentialHashes) hash: p,
       },
       _byEmployee = {for (final p in passengers) p.employeeNumber: p};

  factory TripManifest.fromJson(Map<String, dynamic> json) => TripManifest(
    tripId: json['tripId'] as String,
    passengers: (json['passengers'] as List<dynamic>)
        .cast<Map<String, dynamic>>()
        .map(ManifestPassenger.fromJson)
        .toList(),
    boarded: (json['boarded'] as List<dynamic>).cast<String>().toSet(),
  );

  final String tripId;
  final List<ManifestPassenger> passengers;

  /// Ya escaneados en el servidor cuando se descargó la lista.
  final Set<String> boarded;
  final Map<String, ManifestPassenger> _byHash;
  final Map<String, ManifestPassenger> _byEmployee;

  ManifestPassenger? byCredentialHash(String hash) => _byHash[hash];

  ManifestPassenger? byEmployeeNumber(String number) => _byEmployee[number];

  Map<String, Object?> toJson() => {
    'tripId': tripId,
    'passengers': [for (final p in passengers) p.toJson()],
    'boarded': boarded.toList(),
  };
}
