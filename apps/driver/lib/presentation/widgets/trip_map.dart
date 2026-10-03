import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../application/providers.dart';
import '../../application/trips/trip_providers.dart';
import '../../core/theme/app_theme.dart';
import '../../domain/trips/trip_models.dart';

/// Mapa del viaje: la ruta, las paradas en orden (las ya visitadas en gris, la siguiente
/// resaltada). Los mosaicos se guardan en el celular para verse sin señal.
class TripMap extends ConsumerWidget {
  const TripMap({super.key, required this.trip});

  final DriverTrip trip;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tilesEnabled = ref.watch(mapTilesEnabledProvider);
    final template = ref.watch(appConfigProvider).tileUrlTemplate;
    final points = [for (final s in trip.stops) LatLng(s.lat, s.lng)];
    final next = trip.nextStop;
    if (points.isEmpty) {
      return const Center(
        child: Text('Este viaje no tiene paradas en el mapa.'),
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: FlutterMap(
        key: const Key('trip-map'),
        options: MapOptions(
          initialCameraFit: points.length > 1
              ? CameraFit.coordinates(
                  coordinates: points,
                  padding: const EdgeInsets.all(40),
                )
              : null,
          initialCenter: points.first,
          initialZoom: 14,
        ),
        children: [
          if (tilesEnabled)
            TileLayer(
              urlTemplate: template,
              userAgentPackageName: 'mx.shiftlane.driver',
            ),
          PolylineLayer(
            polylines: [
              Polyline(
                points: points,
                strokeWidth: 6,
                color: ShiftlaneColors.blue,
              ),
            ],
          ),
          MarkerLayer(
            markers: [
              for (final stop in trip.stops)
                Marker(
                  point: LatLng(stop.lat, stop.lng),
                  width: 40,
                  height: 40,
                  child: _StopMarker(
                    number: stop.sequence + 1,
                    visited: trip.stopsArrived.contains(stop.id),
                    next: stop.id == next?.id,
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StopMarker extends StatelessWidget {
  const _StopMarker({
    required this.number,
    required this.visited,
    required this.next,
  });

  final int number;
  final bool visited;
  final bool next;

  @override
  Widget build(BuildContext context) {
    final color = visited
        ? Colors.grey
        : next
        ? ShiftlaneColors.amber
        : ShiftlaneColors.navy;
    return Container(
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 3),
      ),
      alignment: Alignment.center,
      child: Text(
        '$number',
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w800,
          fontSize: 16,
        ),
      ),
    );
  }
}
