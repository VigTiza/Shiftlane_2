import 'package:flutter/material.dart';

void main() {
  runApp(const ShiftlaneDriverApp());
}

class ShiftlaneDriverApp extends StatelessWidget {
  const ShiftlaneDriverApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      title: 'Shiftlane Chofer',
      home: Scaffold(body: Center(child: Text('Shiftlane Chofer'))),
    );
  }
}
