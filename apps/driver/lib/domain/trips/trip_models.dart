enum TripStatus { scheduled, inProgress, completed, cancelled }

TripStatus tripStatusFrom(String value) => switch (value) {
  'in_progress' => TripStatus.inProgress,
  'completed' => TripStatus.completed,
  'cancelled' => TripStatus.cancelled,
  _ => TripStatus.scheduled,
};

class TripStop {
  const TripStop({
    required this.id,
    required this.sequence,
    required this.name,
    required this.lat,
    required this.lng,
    required this.radiusMeters,
    this.time,
  });

  factory TripStop.fromJson(Map<String, dynamic> json) {
    final location = json['location'] as Map<String, dynamic>;
    final times = (json['times'] as List<dynamic>? ?? [])
        .cast<Map<String, dynamic>>();
    final general = times.where((t) => (t['weekdays'] as List).isEmpty);
    return TripStop(
      id: json['id'] as String,
      sequence: json['sequence'] as int,
      name: json['name'] as String,
      lat: (location['lat'] as num).toDouble(),
      lng: (location['lng'] as num).toDouble(),
      radiusMeters: json['radiusMeters'] as int,
      time:
          (general.isNotEmpty ? general.first : times.firstOrNull)?['time']
              as String?,
    );
  }

  final String id;
  final int sequence;
  final String name;
  final double lat;
  final double lng;
  final int radiusMeters;

  /// HH:MM programada.
  final String? time;
}

/// Viaje del día del chofer (respuesta de GET /driver/trips).
class DriverTrip {
  const DriverTrip({
    required this.id,
    required this.status,
    required this.direction,
    required this.scheduledStartAt,
    required this.scheduledEndAt,
    required this.canStartFrom,
    required this.plantName,
    required this.expectedPassengers,
    required this.onboard,
    required this.checklistDone,
    required this.checklistPassed,
    required this.exceptionAuthorized,
    required this.stops,
    this.routeCode,
    this.routeName,
    this.vehicleNumber,
    this.capacity,
    this.stopsArrived = const {},
  });

  factory DriverTrip.fromJson(Map<String, dynamic> json) {
    final route = json['route'] as Map<String, dynamic>?;
    final vehicle = json['vehicle'] as Map<String, dynamic>?;
    final checklist = json['checklist'] as Map<String, dynamic>;
    return DriverTrip(
      id: json['id'] as String,
      status: tripStatusFrom(json['status'] as String),
      direction: json['direction'] as String,
      scheduledStartAt: DateTime.parse(json['scheduledStartAt'] as String),
      scheduledEndAt: DateTime.parse(json['scheduledEndAt'] as String),
      canStartFrom: DateTime.parse(json['canStartFrom'] as String),
      routeCode: route?['code'] as String?,
      routeName: route?['name'] as String?,
      plantName: (json['plant'] as Map<String, dynamic>)['name'] as String,
      vehicleNumber: vehicle?['economicNumber'] as String?,
      capacity: vehicle?['capacity'] as int?,
      expectedPassengers: json['expectedPassengers'] as int,
      onboard: json['onboard'] as int,
      checklistDone: checklist['done'] as bool,
      checklistPassed: checklist['passed'] as bool,
      exceptionAuthorized: checklist['exceptionAuthorized'] as bool,
      stops: (json['stops'] as List<dynamic>)
          .cast<Map<String, dynamic>>()
          .map(TripStop.fromJson)
          .toList(),
    );
  }

  final String id;
  final TripStatus status;
  final String direction;
  final DateTime scheduledStartAt;
  final DateTime scheduledEndAt;
  final DateTime canStartFrom;
  final String? routeCode;
  final String? routeName;
  final String plantName;
  final String? vehicleNumber;
  final int? capacity;
  final int expectedPassengers;
  final int onboard;
  final bool checklistDone;
  final bool checklistPassed;
  final bool exceptionAuthorized;
  final List<TripStop> stops;
  final Set<String> stopsArrived;

  String get title => routeCode != null
      ? '$routeCode · ${routeName ?? plantName}'
      : 'Viaje extra · $plantName';

  /// El checklist permite salir: aprobado o con la autorización del despachador.
  bool get checklistAllowsStart =>
      checklistDone && (checklistPassed || exceptionAuthorized);

  bool get overCapacity => capacity != null && onboard > capacity!;

  /// La primera parada a la que todavía no llega.
  TripStop? get nextStop =>
      stops.where((s) => !stopsArrived.contains(s.id)).firstOrNull;

  DriverTrip copyWith({
    TripStatus? status,
    int? onboard,
    Set<String>? stopsArrived,
    bool? checklistDone,
    bool? checklistPassed,
  }) => DriverTrip(
    id: id,
    status: status ?? this.status,
    direction: direction,
    scheduledStartAt: scheduledStartAt,
    scheduledEndAt: scheduledEndAt,
    canStartFrom: canStartFrom,
    routeCode: routeCode,
    routeName: routeName,
    plantName: plantName,
    vehicleNumber: vehicleNumber,
    capacity: capacity,
    expectedPassengers: expectedPassengers,
    onboard: onboard ?? this.onboard,
    checklistDone: checklistDone ?? this.checklistDone,
    checklistPassed: checklistPassed ?? this.checklistPassed,
    exceptionAuthorized: exceptionAuthorized,
    stops: stops,
    stopsArrived: stopsArrived ?? this.stopsArrived,
  );
}

class ChecklistPoint {
  const ChecklistPoint({
    required this.key,
    required this.label,
    required this.photoRequired,
  });

  factory ChecklistPoint.fromJson(Map<String, dynamic> json) => ChecklistPoint(
    key: json['key'] as String,
    label: json['label'] as String,
    photoRequired: json['photoRequired'] as bool? ?? false,
  );

  final String key;
  final String label;
  final bool photoRequired;
}

enum IncidentType {
  traffic,
  mechanical,
  accident,
  passenger,
  forcedDetour,
  other,
}

extension IncidentTypeLabel on IncidentType {
  String get label => switch (this) {
    IncidentType.traffic => 'Tráfico',
    IncidentType.mechanical => 'Falla mecánica',
    IncidentType.accident => 'Accidente',
    IncidentType.passenger => 'Pasajero',
    IncidentType.forcedDetour => 'Desvío obligado',
    IncidentType.other => 'Otro',
  };

  /// Nombre que usa la API.
  String get apiName => switch (this) {
    IncidentType.forcedDetour => 'forced_detour',
    _ => name,
  };
}

/// Lo que respondió el servidor por un evento enviado (o que quedó guardado sin señal).
enum SyncStatus { applied, duplicate, rejected, retry, queued }

class ActionResult {
  const ActionResult(this.status, {this.message, this.result});

  final SyncStatus status;
  final String? message;
  final Map<String, dynamic>? result;

  /// Quedó hecho (o se hará al recuperar la señal).
  bool get accepted =>
      status == SyncStatus.applied ||
      status == SyncStatus.duplicate ||
      status == SyncStatus.queued ||
      status == SyncStatus.retry;
}

/// Mensaje del despachador en pantalla.
class DriverMessage {
  const DriverMessage({
    required this.id,
    required this.text,
    required this.sentAt,
  });

  final String id;
  final String text;
  final DateTime sentAt;
}

/// Lo que la app necesita del servidor para los viajes (la capa de datos lo implementa).
abstract interface class TripRepository {
  Future<List<DriverTrip>> todayTrips();

  Future<List<ChecklistPoint>> checklistTemplate();

  /// Sube una foto del viaje (checklist, incidente o evidencia) y devuelve su id.
  Future<String> uploadPhoto(
    String tripId,
    String kind,
    List<int> bytes,
    String fileName,
  );
}
