import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../../core/logging/app_logger.dart';
import '../../domain/trips/trip_models.dart';

/// Eventos que el servidor manda al chofer en tiempo real.
sealed class RealtimeEvent {
  const RealtimeEvent();
}

class DispatcherMessageEvent extends RealtimeEvent {
  const DispatcherMessageEvent(this.message);

  final DriverMessage message;
}

class TripCancelledEvent extends RealtimeEvent {
  const TripCancelledEvent({required this.tripId, this.reason});

  final String tripId;
  final String? reason;
}

class RouteChangedEvent extends RealtimeEvent {
  const RouteChangedEvent({required this.routeId, this.code});

  final String routeId;
  final String? code;
}

abstract interface class RealtimeClient {
  Stream<RealtimeEvent> get events;

  void connect(String accessToken);

  void disconnect();
}

/// Conexión Socket.IO a `/realtime` con el mismo token de la API.
class SocketRealtimeClient implements RealtimeClient {
  SocketRealtimeClient(this.baseUrl);

  final String baseUrl;
  final _events = StreamController<RealtimeEvent>.broadcast();
  final _log = appLogger('realtime');
  io.Socket? _socket;

  @override
  Stream<RealtimeEvent> get events => _events.stream;

  @override
  void connect(String accessToken) {
    disconnect();
    final socket = io.io(
      baseUrl,
      io.OptionBuilder()
          .setPath('/realtime')
          .setTransports(['websocket'])
          .setAuth({'token': accessToken})
          .disableAutoConnect()
          .build(),
    );
    socket
      ..on('message.to_driver', (data) {
        final json = (data as Map).cast<String, dynamic>();
        _events.add(
          DispatcherMessageEvent(
            DriverMessage(
              id: json['id'] as String,
              text: json['text'] as String,
              sentAt: DateTime.parse(json['sentAt'] as String),
            ),
          ),
        );
      })
      ..on('trip.cancelled', (data) {
        final json = (data as Map).cast<String, dynamic>();
        _events.add(
          TripCancelledEvent(
            tripId: json['tripId'] as String,
            reason: json['reason'] as String?,
          ),
        );
      })
      ..on('route.changed', (data) {
        final json = (data as Map).cast<String, dynamic>();
        _events.add(
          RouteChangedEvent(
            routeId: json['routeId'] as String,
            code: json['code'] as String?,
          ),
        );
      })
      ..onConnectError((error) => _log.info('Sin tiempo real: $error'))
      ..connect();
    _socket = socket;
  }

  @override
  void disconnect() {
    _socket?.dispose();
    _socket = null;
  }
}
