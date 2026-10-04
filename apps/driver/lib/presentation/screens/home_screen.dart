import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../application/auth/auth_controller.dart';
import '../../application/auth/auth_providers.dart';
import '../../application/device_check/device_check_controller.dart';
import '../../application/providers.dart';
import '../../application/scan/scan_controller.dart';
import '../../application/update/update_controller.dart';
import '../../application/trips/trip_providers.dart';
import '../../application/trips/trips_controller.dart';
import '../../core/errors/app_failure.dart';
import '../../core/router/app_routes.dart';
import '../../core/theme/app_theme.dart';
import '../../domain/app_version/app_version.dart';
import '../../domain/device_check/device_check.dart';
import '../../domain/trips/trip_models.dart';
import '../widgets/big_button.dart';
import '../widgets/panic_button.dart';

String _hhmm(DateTime date) {
  final local = date.toLocal();
  return '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
}

/// Pantalla principal: tres botones y la lista de viajes del día (el siguiente arriba).
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  bool _starting = false;

  @override
  void initState() {
    super.initState();
    // Guarda el mapa de las rutas y la lista de pasajeros de cada viaje pendiente para
    // trabajar sin señal.
    ref.listenManual(tripsControllerProvider, fireImmediately: true, (_, next) {
      final trips = next.value;
      if (trips == null) return;
      if (ref.read(mapTilesEnabledProvider)) {
        ref.read(routeTilePrefetcherProvider).prefetch(trips).ignore();
      }
      for (final trip in trips) {
        if (trip.status == TripStatus.scheduled ||
            trip.status == TripStatus.inProgress) {
          ref.read(manifestProvider(trip.id).future).ignore();
        }
      }
    });
  }

  Future<void> _startTrip(DriverTrip trip) async {
    if (!trip.checklistAllowsStart) {
      await context.push(AppRoutes.checklist, extra: trip.id);
      return;
    }
    setState(() => _starting = true);
    final result = await ref
        .read(tripsControllerProvider.notifier)
        .start(trip.id);
    if (!mounted) return;
    setState(() => _starting = false);
    if (result.accepted) {
      context.go(AppRoutes.trip);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(result.message ?? 'No se pudo iniciar el viaje.'),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final config = ref.watch(appConfigProvider);
    final auth = ref.watch(authControllerProvider);
    final driverName = auth is AuthSignedIn ? auth.session.fullName : null;
    final check = ref.watch(deviceCheckProvider).report;
    final tripsState = ref.watch(tripsControllerProvider);
    final current = ref.watch(currentTripProvider);
    final inProgress = current?.status == TripStatus.inProgress;
    final canStart =
        current?.status == TripStatus.scheduled &&
        mayStartTrip(check, dispatcherException: current!.exceptionAuthorized);
    final update = ref.watch(updateControllerProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Shiftlane Chofer'),
        actions: [
          if (config.label.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Chip(label: Text(config.label)),
            ),
          PopupMenuButton<String>(
            key: const Key('home-menu'),
            onSelected: (value) {
              switch (value) {
                case 'switch':
                  ref.read(authControllerProvider.notifier).switchDriver();
                case 'check':
                  context.push(AppRoutes.deviceCheck);
                case 'tutorial':
                  context.push(AppRoutes.tutorial);
                case 'help':
                  context.push(AppRoutes.help);
              }
            },
            itemBuilder: (context) => const [
              PopupMenuItem(value: 'check', child: Text('Revisar el celular')),
              PopupMenuItem(value: 'help', child: Text('Tengo un problema')),
              PopupMenuItem(value: 'tutorial', child: Text('Ver tutorial')),
              PopupMenuItem(value: 'switch', child: Text('Cambiar de chofer')),
            ],
          ),
        ],
        bottom: driverName == null
            ? null
            : PreferredSize(
                preferredSize: const Size.fromHeight(32),
                child: Padding(
                  padding: const EdgeInsets.only(left: 16, bottom: 8),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      driverName,
                      style: const TextStyle(color: Colors.white, fontSize: 18),
                    ),
                  ),
                ),
              ),
      ),
      floatingActionButton: PanicButton(
        tripId: inProgress ? current!.id : null,
      ),
      floatingActionButtonLocation: FloatingActionButtonLocation.startFloat,
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () => ref.read(tripsControllerProvider.notifier).refresh(),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 96),
            children: [
              if (update.level != UpdateLevel.none) ...[
                MaterialBanner(
                  key: const Key('update-banner'),
                  backgroundColor: ShiftlaneColors.blue.withValues(alpha: 0.1),
                  content: Text(
                    update.level == UpdateLevel.required
                        ? 'Al terminar el viaje tendrás que actualizar la app.'
                        : 'Hay una versión nueva de la app '
                              '(${update.info?.latestVersion}).',
                  ),
                  actions: [
                    if (update.info?.downloadUrl != null)
                      TextButton(
                        key: const Key('update-banner-action'),
                        onPressed: () => ref.read(urlOpenerProvider)(
                          Uri.parse(update.info!.downloadUrl!),
                        ),
                        child: const Text('Actualizar'),
                      )
                    else
                      const SizedBox.shrink(),
                  ],
                ),
                const SizedBox(height: 16),
              ],
              if (check != null && !check.canStartTrip) ...[
                MaterialBanner(
                  key: const Key('home-check-banner'),
                  backgroundColor: ShiftlaneColors.red.withValues(alpha: 0.1),
                  content: const Text(
                    'Tu celular tiene algo por arreglar antes de iniciar viajes.',
                  ),
                  actions: [
                    TextButton(
                      onPressed: () => context.push(AppRoutes.deviceCheck),
                      child: const Text('Revisar'),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
              ],
              BigButton(
                key: const Key('home-start'),
                label: 'Iniciar viaje',
                icon: Icons.play_arrow_rounded,
                onPressed: canStart && !_starting
                    ? () => _startTrip(current)
                    : null,
                color: ShiftlaneColors.green,
              ),
              const SizedBox(height: 16),
              BigButton(
                key: const Key('home-scan'),
                label: 'Escanear pasajero',
                icon: Icons.qr_code_scanner_rounded,
                onPressed: inProgress
                    ? () => context.push(AppRoutes.scan)
                    : null,
              ),
              const SizedBox(height: 16),
              BigButton(
                key: const Key('home-finish'),
                label: 'Terminar viaje',
                icon: Icons.flag_rounded,
                onPressed: inProgress
                    ? () => context.push(AppRoutes.arrival)
                    : null,
                color: ShiftlaneColors.red,
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                key: const Key('home-help'),
                onPressed: () => context.push(AppRoutes.help),
                icon: const Icon(Icons.support_agent),
                label: const Text('Tengo un problema'),
              ),
              const SizedBox(height: 24),
              Text(
                'Viajes de hoy',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              ...switch (tripsState) {
                AsyncData(:final value) when value.isEmpty => [
                  const Text('No tienes viajes asignados hoy.'),
                ],
                AsyncData(:final value) => [
                  for (final trip in value) _TripTile(trip: trip),
                ],
                AsyncError(:final error) => [
                  Text(
                    error is AppFailure
                        ? error.message
                        : 'No se pudieron cargar tus viajes.',
                  ),
                  TextButton(
                    onPressed: () =>
                        ref.read(tripsControllerProvider.notifier).refresh(),
                    child: const Text('Reintentar'),
                  ),
                ],
                _ => [const Center(child: CircularProgressIndicator())],
              },
            ],
          ),
        ),
      ),
    );
  }
}

class _TripTile extends StatelessWidget {
  const _TripTile({required this.trip});

  final DriverTrip trip;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (trip.status) {
      TripStatus.inProgress => ('En curso', ShiftlaneColors.green),
      TripStatus.scheduled => ('Programado', ShiftlaneColors.navy),
      TripStatus.completed => ('Terminado', Colors.grey),
      TripStatus.cancelled => ('Cancelado', ShiftlaneColors.red),
    };
    return Card(
      child: ListTile(
        key: Key('trip-${trip.id}'),
        title: Text(
          trip.title,
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
        ),
        subtitle: Text(
          '${_hhmm(trip.scheduledStartAt)} a ${_hhmm(trip.scheduledEndAt)}'
          '${trip.vehicleNumber != null ? ' · ${trip.vehicleNumber}' : ''}',
        ),
        trailing: Chip(
          label: Text(label, style: const TextStyle(color: Colors.white)),
          backgroundColor: color,
        ),
        onTap: trip.status == TripStatus.inProgress
            ? () => context.push(AppRoutes.trip)
            : null,
      ),
    );
  }
}
