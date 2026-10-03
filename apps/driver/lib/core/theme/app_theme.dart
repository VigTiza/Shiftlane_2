import 'package:flutter/material.dart';

/// Colores de Shiftlane con alto contraste para leer al sol dentro de la unidad.
abstract final class ShiftlaneColors {
  static const navy = Color(0xFF0B2545);
  static const blue = Color(0xFF13315C);
  static const amber = Color(0xFFFFB703);
  static const green = Color(0xFF1B7F3B);
  static const red = Color(0xFFB3261E);
  static const surface = Color(0xFFFFFFFF);
  static const background = Color(0xFFF2F4F7);
  static const text = Color(0xFF111111);
}

/// Altura mínima de los botones: se usan con prisa y a veces con guantes.
const double kMinButtonHeight = 56;

ThemeData buildShiftlaneTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: ShiftlaneColors.navy,
    primary: ShiftlaneColors.navy,
    secondary: ShiftlaneColors.amber,
    error: ShiftlaneColors.red,
    surface: ShiftlaneColors.surface,
  );
  const buttonText = TextStyle(fontSize: 20, fontWeight: FontWeight.w700);
  final buttonShape = RoundedRectangleBorder(
    borderRadius: BorderRadius.circular(14),
  );
  final buttonSize = WidgetStateProperty.all(
    const Size(kMinButtonHeight, kMinButtonHeight),
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: ShiftlaneColors.background,
    visualDensity: VisualDensity.standard,
    materialTapTargetSize: MaterialTapTargetSize.padded,
    textTheme: const TextTheme(
      headlineMedium: TextStyle(
        fontSize: 28,
        fontWeight: FontWeight.w800,
        color: ShiftlaneColors.text,
      ),
      titleLarge: TextStyle(
        fontSize: 22,
        fontWeight: FontWeight.w700,
        color: ShiftlaneColors.text,
      ),
      bodyLarge: TextStyle(fontSize: 18, color: ShiftlaneColors.text),
      bodyMedium: TextStyle(fontSize: 16, color: ShiftlaneColors.text),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: ShiftlaneColors.navy,
      foregroundColor: Colors.white,
      centerTitle: false,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: ButtonStyle(
        minimumSize: buttonSize,
        textStyle: WidgetStateProperty.all(buttonText),
        shape: WidgetStateProperty.all(buttonShape),
        padding: WidgetStateProperty.all(
          const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
        ),
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ButtonStyle(
        minimumSize: buttonSize,
        textStyle: WidgetStateProperty.all(buttonText),
        shape: WidgetStateProperty.all(buttonShape),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: ButtonStyle(
        minimumSize: buttonSize,
        textStyle: WidgetStateProperty.all(buttonText),
        shape: WidgetStateProperty.all(buttonShape),
        side: WidgetStateProperty.all(
          const BorderSide(color: ShiftlaneColors.navy, width: 2),
        ),
      ),
    ),
  );
}
