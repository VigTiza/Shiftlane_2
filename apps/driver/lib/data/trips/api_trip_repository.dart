import 'package:dio/dio.dart';

import '../../core/network/api_client.dart';
import '../../domain/trips/trip_models.dart';

/// Viajes del día, checklist y fotos con la API de Shiftlane.
class ApiTripRepository implements TripRepository {
  ApiTripRepository(this._api);

  final ApiClient _api;

  @override
  Future<List<DriverTrip>> todayTrips() async {
    final json = await _api.get<Map<String, dynamic>>('/driver/trips');
    return (json['trips'] as List<dynamic>)
        .cast<Map<String, dynamic>>()
        .map(DriverTrip.fromJson)
        .toList();
  }

  @override
  Future<List<ChecklistPoint>> checklistTemplate() async {
    final json = await _api.get<Map<String, dynamic>>(
      '/driver/checklist-template',
    );
    return (json['items'] as List<dynamic>)
        .cast<Map<String, dynamic>>()
        .map(ChecklistPoint.fromJson)
        .toList();
  }

  @override
  Future<String> uploadPhoto(
    String tripId,
    String kind,
    List<int> bytes,
    String fileName,
  ) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/driver/trips/$tripId/photos?kind=$kind',
      body: FormData.fromMap({
        'file': MultipartFile.fromBytes(bytes, filename: fileName),
      }),
    );
    return json['id'] as String;
  }
}
