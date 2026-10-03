import 'device_check.dart';

/// Pasos para arreglar un punto según la marca del celular (los menús cambian por marca).
class FixGuide {
  const FixGuide({required this.steps, required this.path, this.buttonLabel});

  final List<String> steps;

  /// Ruta en los ajustes que se dibuja en la ilustración.
  final List<String> path;

  /// Texto del botón que abre la pantalla exacta (null si no hay pantalla que abrir).
  final String? buttonLabel;
}

const _genericGuides = <CheckItem, FixGuide>{
  CheckItem.locationService: FixGuide(
    steps: [
      'Desliza la barra de arriba hacia abajo.',
      'Toca «Ubicación» para encenderla.',
    ],
    path: ['Ajustes', 'Ubicación', 'Usar ubicación'],
    buttonLabel: 'Abrir ajustes de ubicación',
  ),
  CheckItem.locationAlways: FixGuide(
    steps: [
      'Toca «Dar permiso».',
      'En «Ubicación», elige «Permitir todo el tiempo».',
    ],
    path: ['Ajustes', 'Aplicaciones', 'Shiftlane', 'Permisos', 'Ubicación'],
    buttonLabel: 'Dar permiso',
  ),
  CheckItem.batteryOptimization: FixGuide(
    steps: [
      'Toca «Quitar del ahorro».',
      'Elige «Permitir» o «Sin restricciones».',
    ],
    path: ['Ajustes', 'Batería', 'Optimización de batería', 'Shiftlane'],
    buttonLabel: 'Quitar del ahorro',
  ),
  CheckItem.battery: FixGuide(
    steps: ['Conecta el celular al cargador de la unidad.'],
    path: ['Cargador de la unidad'],
  ),
  CheckItem.mobileData: FixGuide(
    steps: [
      'Desliza la barra de arriba hacia abajo.',
      'Enciende «Datos móviles».',
    ],
    path: ['Ajustes', 'Redes', 'Datos móviles'],
    buttonLabel: 'Abrir ajustes de datos',
  ),
  CheckItem.clock: FixGuide(
    steps: [
      'Activa «Fecha y hora automáticas».',
      'Activa «Zona horaria automática».',
    ],
    path: ['Ajustes', 'Sistema', 'Fecha y hora'],
    buttonLabel: 'Abrir fecha y hora',
  ),
  CheckItem.camera: FixGuide(
    steps: ['Toca «Dar permiso» y elige «Permitir».'],
    path: ['Ajustes', 'Aplicaciones', 'Shiftlane', 'Permisos', 'Cámara'],
    buttonLabel: 'Dar permiso',
  ),
  CheckItem.appVersion: FixGuide(
    steps: [
      'La app se actualiza sola al abrirla con señal.',
      'Si no se actualiza, pide ayuda al despachador.',
    ],
    path: ['Shiftlane', 'Actualizar'],
  ),
};

/// Diferencias de cada marca (lo demás es igual al genérico).
const _brandGuides = <PhoneBrand, Map<CheckItem, FixGuide>>{
  PhoneBrand.samsung: {
    CheckItem.batteryOptimization: FixGuide(
      steps: [
        'Toca «Quitar del ahorro» y elige «Sin restricciones».',
        'En Batería, entra a «Límites de uso en segundo plano».',
        'Quita Shiftlane de «Aplicaciones en suspensión».',
      ],
      path: [
        'Ajustes',
        'Batería',
        'Límites de uso en segundo plano',
        'Aplicaciones en suspensión',
      ],
      buttonLabel: 'Quitar del ahorro',
    ),
    CheckItem.locationAlways: FixGuide(
      steps: [
        'Toca «Dar permiso».',
        'Elige «Permitir todo el tiempo».',
        'Activa «Usar ubicación precisa».',
      ],
      path: ['Ajustes', 'Aplicaciones', 'Shiftlane', 'Permisos', 'Ubicación'],
      buttonLabel: 'Dar permiso',
    ),
  },
  PhoneBrand.motorola: {
    CheckItem.batteryOptimization: FixGuide(
      steps: [
        'Toca «Quitar del ahorro».',
        'En «Uso de batería de la app», elige «Sin restricciones».',
      ],
      path: ['Ajustes', 'Apps', 'Shiftlane', 'Batería', 'Sin restricciones'],
      buttonLabel: 'Quitar del ahorro',
    ),
  },
  PhoneBrand.xiaomi: {
    CheckItem.batteryOptimization: FixGuide(
      steps: [
        'Toca «Quitar del ahorro».',
        'En «Ahorro de batería», elige «Sin restricciones».',
        'En «Inicio automático», activa Shiftlane.',
      ],
      path: [
        'Ajustes',
        'Aplicaciones',
        'Administrar aplicaciones',
        'Shiftlane',
        'Ahorro de batería',
      ],
      buttonLabel: 'Quitar del ahorro',
    ),
    CheckItem.locationAlways: FixGuide(
      steps: [
        'Toca «Dar permiso».',
        'En «Ubicación», elige «Permitir todo el tiempo».',
        'En «Otros permisos», activa «Mostrar en pantalla de bloqueo».',
      ],
      path: [
        'Ajustes',
        'Aplicaciones',
        'Administrar aplicaciones',
        'Shiftlane',
        'Permisos de la app',
      ],
      buttonLabel: 'Dar permiso',
    ),
  },
};

FixGuide guideFor(PhoneBrand brand, CheckItem item) =>
    _brandGuides[brand]?[item] ?? _genericGuides[item]!;

String brandLabel(PhoneBrand brand) => switch (brand) {
  PhoneBrand.samsung => 'Samsung',
  PhoneBrand.motorola => 'Motorola',
  PhoneBrand.xiaomi => 'Xiaomi',
  PhoneBrand.generic => 'tu celular',
};
