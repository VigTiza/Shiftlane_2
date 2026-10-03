# Índice de prompts — Shiftlane

76 prompts en 23 fases. Generado por `infra/scripts/docx-a-markdown.py`
a partir de [plan-de-desarrollo.md](plan-de-desarrollo.md); no lo edites a mano.

La columna «Línea» indica dónde empieza cada prompt en el plan, para leerlo directo.
El avance se registra en [docs/AVANCES.md](../AVANCES.md), no aquí.

| Código | Título | Fase | Línea |
|---|---|---|---|
| F00-P01 | Estructura del monorepo, CLAUDE.md y bitácora | F00 — Preparación del workspace | 274 |
| F00-P02 | Documentos de referencia en Markdown | F00 — Preparación del workspace | 290 |
| F00-P03 | Entorno local, calidad de código e integración continua | F00 — Preparación del workspace | 304 |
| F01-P01 | Esqueleto de la API | F01 — Núcleo del backend | 324 |
| F01-P02 | Esquema de base de datos y seguridad por filas | F01 — Núcleo del backend | 336 |
| F01-P03 | Autenticación y sesiones | F01 — Núcleo del backend | 351 |
| F01-P04 | Roles, permisos y auditoría | F01 — Núcleo del backend | 365 |
| F02-P01 | Unidades, choferes y documentos | F02 — Catálogos | 382 |
| F02-P02 | Clientes, plantas, contratos y tarifas | F02 — Catálogos | 395 |
| F02-P03 | Pasajeros y credenciales | F02 — Catálogos | 406 |
| F03-P01 | Modelo de rutas con PostGIS | F03 — Rutas y paradas | 425 |
| F03-P02 | Cálculos geográficos | F03 — Rutas y paradas | 436 |
| F03-P03 | Cambios temporales y simulación | F03 — Rutas y paradas | 447 |
| F04-P01 | Generador de viajes | F04 — Programación de servicios | 463 |
| F04-P02 | Asignación y conflictos | F04 — Programación de servicios | 473 |
| F04-P03 | Viajes extraordinarios y solicitudes | F04 — Programación de servicios | 485 |
| F05-P01 | Ciclo de vida del viaje | F05 — Operación de viajes y tiempo real | 500 |
| F05-P02 | Sincronización sin señal (idempotente) | F05 — Operación de viajes y tiempo real | 510 |
| F05-P03 | Ingesta GPS y posiciones | F05 — Operación de viajes y tiempo real | 521 |
| F05-P04 | Tiempo real con Socket.IO | F05 — Operación de viajes y tiempo real | 532 |
| F06-P01 | Motor de alertas | F06 — Alertas y diagnóstico | 549 |
| F06-P02 | Reportes de salud del celular y diagnóstico | F06 — Alertas y diagnóstico | 562 |
| F06-P03 | Simulador de flota | F06 — Alertas y diagnóstico | 574 |
| F07-P01 | Proyecto Flutter y arquitectura | F07 — App del chofer (Flutter) | 590 |
| F07-P02 | Acceso con QR y PIN | F07 — App del chofer (Flutter) | 602 |
| F07-P03 | Revisión del celular antes del turno | F07 — App del chofer (Flutter) | 612 |
| F07-P04 | Pantalla principal, checklist y viaje | F07 — App del chofer (Flutter) | 625 |
| F07-P05 | Ubicación en segundo plano y modo sin señal | F07 — App del chofer (Flutter) | 639 |
| F07-P06 | Escaneo de pasajeros | F07 — App del chofer (Flutter) | 652 |
| F07-P07 | Notificaciones, actualización y pruebas integrales | F07 — App del chofer (Flutter) | 664 |
| F08-P01 | Proyecto web y sistema de diseño | F08 — Panel web de la transportista | 681 |
| F08-P02 | Asistente de configuración inicial y catálogos | F08 — Panel web de la transportista | 696 |
| F08-P03 | Editor de rutas | F08 — Panel web de la transportista | 706 |
| F08-P04 | Programación | F08 — Panel web de la transportista | 716 |
| F08-P05 | Monitoreo en vivo y alertas | F08 — Panel web de la transportista | 726 |
| F08-P06 | CRM, cumplimiento y mantenimiento (pantallas) | F08 — Panel web de la transportista | 740 |
| F08-P07 | Tablero de inicio, reportes y configuración | F08 — Panel web de la transportista | 751 |
| F09-P01 | Tablero en vivo y evidencia | F09 — Portal de la planta | 769 |
| F09-P02 | Empleados, solicitudes y cumplimiento | F09 — Portal de la planta | 781 |
| F09-P03 | Prefacturas y reportes | F09 — Portal de la planta | 791 |
| F10-P01 | PWA base y activación | F10 — App del pasajero (PWA) | 807 |
| F10-P02 | Ubicación del camión, avisos y calificación | F10 — App del pasajero (PWA) | 818 |
| F11-P01 | Vencimientos y expedientes | F11 — Cumplimiento, mantenimiento y combustible | 834 |
| F11-P02 | Mantenimiento y combustible | F11 — Cumplimiento, mantenimiento y combustible | 844 |
| F12-P01 | Motor de conciliación | F12 — Conciliación y facturación al cliente | 860 |
| F12-P02 | Objeciones y aprobación | F12 — Conciliación y facturación al cliente | 870 |
| F12-P03 | Factura electrónica y cuentas por cobrar | F12 — Conciliación y facturación al cliente | 879 |
| F13-P01 | Modelo de cobro | F13 — Suscripciones y cobro de la plataforma | 896 |
| F13-P02 | Facturación mensual, pagos y morosidad | F13 — Suscripciones y cobro de la plataforma | 910 |
| F13-P03 | Pantallas de cobro | F13 — Suscripciones y cobro de la plataforma | 923 |
| F14-P01 | Motor de notificaciones | F14 — Notificaciones multicanal | 940 |
| F14-P02 | Canales y respaldo | F14 — Notificaciones multicanal | 950 |
| F15-P01 | Centro de ayuda y ayuda contextual | F15 — Autoservicio y ayuda | 967 |
| F15-P02 | Asistente con datos de la cuenta | F15 — Autoservicio y ayuda | 978 |
| F15-P03 | Tickets por niveles | F15 — Autoservicio y ayuda | 989 |
| F15-P04 | Página de estado y avisos automáticos | F15 — Autoservicio y ayuda | 1000 |
| F16-P01 | Cuentas, cobro y prospectos | F16 — Consola de plataforma | 1017 |
| F16-P02 | Salud de clientes y del sistema | F16 — Consola de plataforma | 1028 |
| F17-P01 | Integración con Android Management API | F17 — Administración de celulares y modo kiosco | 1045 |
| F17-P02 | Pantallas de dispositivos | F17 — Administración de celulares y modo kiosco | 1057 |
| F18-P01 | Dirección de arte y estructura | F18 — Landing page con animaciones 3D | 1072 |
| F18-P02 | Modelos 3D en Blender | F18 — Landing page con animaciones 3D | 1089 |
| F18-P03 | Escena 3D principal: el camión recorre la página | F18 — Landing page con animaciones 3D | 1106 |
| F18-P04 | Mapa en vivo con el camión 3D | F18 — Landing page con animaciones 3D | 1123 |
| F18-P05 | Contenido, interacciones y conversión | F18 — Landing page con animaciones 3D | 1134 |
| F18-P06 | Rendimiento, accesibilidad, SEO y publicación | F18 — Landing page con animaciones 3D | 1147 |
| F19-P01 | Auditoría de seguridad | F19 — Seguridad y endurecimiento | 1167 |
| F19-P02 | Correcciones y pruebas de seguridad | F19 — Seguridad y endurecimiento | 1178 |
| F20-P01 | Pruebas extremo a extremo de un día completo | F20 — Pruebas integrales y QA | 1193 |
| F20-P02 | Pruebas de carga y resistencia | F20 — Pruebas integrales y QA | 1203 |
| F20-P03 | Revisión de calidad y corrección de errores | F20 — Pruebas integrales y QA | 1214 |
| F21-P01 | Infraestructura de producción | F21 — Despliegue, monitoreo y respaldos | 1229 |
| F21-P02 | CI/CD y publicación segura | F21 — Despliegue, monitoreo y respaldos | 1240 |
| F21-P03 | Monitoreo, alertas y respaldos | F21 — Despliegue, monitoreo y respaldos | 1251 |
| F22-P01 | Manuales y documentación técnica | F22 — Documentación y piloto | 1267 |
| F22-P02 | Preparación del piloto | F22 — Documentación y piloto | 1277 |
