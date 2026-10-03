import 'package:app_settings/app_settings.dart';
import 'package:battery_plus/battery_plus.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../domain/device_check/device_check.dart';

/// Lecturas reales del celular Android con los plugins del sistema.
class PluginDeviceProbe implements DeviceProbe {
  @override
  Future<DeviceReadings> read() async {
    final android = await DeviceInfoPlugin().androidInfo;
    final package = await PackageInfo.fromPlatform();
    final battery = Battery();
    final connectivity = await Connectivity().checkConnectivity();
    final always = await Permission.locationAlways.status;
    final whileInUse = await Permission.locationWhenInUse.status;
    final batteryState = await battery.batteryState;
    return DeviceReadings(
      locationServiceEnabled: await Permission.location.serviceStatus.isEnabled,
      locationPermission: always.isGranted
          ? LocationPermission.always
          : whileInUse.isGranted
          ? LocationPermission.whileInUse
          : LocationPermission.denied,
      batteryOptimizationIgnored:
          await Permission.ignoreBatteryOptimizations.isGranted,
      batteryLevel: await battery.batteryLevel,
      charging:
          batteryState == BatteryState.charging ||
          batteryState == BatteryState.full,
      network: connectivity.contains(ConnectivityResult.mobile)
          ? NetworkType.cellular
          : connectivity.contains(ConnectivityResult.wifi)
          ? NetworkType.wifi
          : NetworkType.none,
      cameraGranted: await Permission.camera.isGranted,
      appVersion: package.version,
      manufacturer: android.manufacturer,
      model: android.model,
      osVersion: 'Android ${android.version.release}',
    );
  }
}

/// Pide el permiso o abre la pantalla de ajustes exacta de cada punto.
class PluginDeviceFixer implements DeviceFixer {
  @override
  Future<void> fix(FixAction action) async {
    switch (action) {
      case FixAction.openLocationSettings:
        await AppSettings.openAppSettings(type: AppSettingsType.location);
      case FixAction.requestLocationAlways:
        // Android pide primero «mientras se usa» y después «todo el tiempo».
        final whileInUse = await Permission.locationWhenInUse.request();
        final always = whileInUse.isGranted
            ? await Permission.locationAlways.request()
            : whileInUse;
        if (always.isPermanentlyDenied) await openAppSettings();
      case FixAction.disableBatteryOptimization:
        final status = await Permission.ignoreBatteryOptimizations.request();
        if (!status.isGranted) {
          await AppSettings.openAppSettings(
            type: AppSettingsType.batteryOptimization,
          );
        }
      case FixAction.openDataSettings:
        await AppSettings.openAppSettings(type: AppSettingsType.dataRoaming);
      case FixAction.openDateSettings:
        await AppSettings.openAppSettings(type: AppSettingsType.date);
      case FixAction.requestCamera:
        final status = await Permission.camera.request();
        if (status.isPermanentlyDenied) await openAppSettings();
      case FixAction.chargePhone:
      case FixAction.updateApp:
        // Solo hay instrucciones: no hay una pantalla que abrir.
        break;
    }
  }
}
