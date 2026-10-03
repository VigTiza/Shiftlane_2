import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shiftlane_driver/app.dart';
import 'package:shiftlane_driver/application/providers.dart';
import 'package:shiftlane_driver/core/config/environment.dart';
import 'package:shiftlane_driver/data/local/app_database.dart';

void main() {
  testWidgets('arranca en la pantalla principal con el ambiente visible', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          appConfigProvider.overrideWithValue(
            AppConfig.fromValues(environment: 'staging'),
          ),
          appDatabaseProvider.overrideWithValue(
            AppDatabase(NativeDatabase.memory()),
          ),
        ],
        child: const ShiftlaneDriverApp(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Shiftlane Chofer'), findsOneWidget);
    expect(find.text('Pruebas'), findsOneWidget);
    expect(find.text('Iniciar viaje'), findsOneWidget);
    expect(find.text('Escanear pasajero'), findsOneWidget);
    expect(find.text('Terminar viaje'), findsOneWidget);
  });

  testWidgets('en producción no se muestra el ambiente', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          appConfigProvider.overrideWithValue(
            AppConfig.fromValues(environment: 'prod'),
          ),
        ],
        child: const ShiftlaneDriverApp(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(Chip), findsNothing);
  });
}
