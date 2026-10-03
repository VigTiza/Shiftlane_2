import 'package:flutter/material.dart';

import '../../domain/device_check/device_check.dart';

/// Ilustración del menú de ajustes de cada marca: un celular con la ruta a seguir y el
/// último paso resaltado.
class SettingsPathIllustration extends StatelessWidget {
  const SettingsPathIllustration({
    super.key,
    required this.brand,
    required this.path,
  });

  final PhoneBrand brand;
  final List<String> path;

  /// Colores parecidos a los ajustes de cada marca para que el chofer los reconozca.
  Color get _accent => switch (brand) {
    PhoneBrand.samsung => const Color(0xFF1259C3),
    PhoneBrand.motorola => const Color(0xFF5C2D91),
    PhoneBrand.xiaomi => const Color(0xFFFF6900),
    PhoneBrand.generic => const Color(0xFF1A73E8),
  };

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        key: Key('illustration-${brand.name}'),
        width: 240,
        padding: const EdgeInsets.fromLTRB(12, 18, 12, 18),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(28),
          border: Border.all(color: Colors.black87, width: 6),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              path.first,
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w800,
                color: _accent,
              ),
            ),
            const SizedBox(height: 8),
            for (final (index, entry) in path.skip(1).indexed)
              Container(
                margin: const EdgeInsets.only(top: 6),
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 10,
                ),
                decoration: BoxDecoration(
                  color: index == path.length - 2
                      ? _accent.withValues(alpha: 0.15)
                      : const Color(0xFFF1F3F4),
                  border: index == path.length - 2
                      ? Border.all(color: _accent, width: 2)
                      : null,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(entry, style: const TextStyle(fontSize: 15)),
                    ),
                    Icon(Icons.chevron_right, color: _accent),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
