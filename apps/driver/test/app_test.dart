import 'package:flutter_test/flutter_test.dart';
import 'package:shiftlane_driver/main.dart';

void main() {
  testWidgets('muestra el nombre de la app', (tester) async {
    await tester.pumpWidget(const ShiftlaneDriverApp());

    expect(find.text('Shiftlane Chofer'), findsOneWidget);
  });
}
