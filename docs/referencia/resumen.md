# Shiftlane — Resumen de referencia

Consulta rápida. Detalle en [descripcion-funcional.md](descripcion-funcional.md) (DF) y [sistema-de-precios.md](sistema-de-precios.md) (SP).

## Qué es
SaaS para empresas de transporte de personal en México: planear, operar, comprobar y cobrar cada viaje que hacen para las plantas que las contratan. Debe funcionar casi sin soporte del dueño de la plataforma.

## Módulos y componentes
- **Sitio web público:** presentación, solicitud de demo o piloto (crea el prospecto), registro autoservicio, ayuda pública, página de estado, avisos legales.
- **Panel de la transportista** (apps/web): inicio, asistente de configuración de 8 pasos, catálogos (unidades, choferes, clientes y plantas, contratos y tarifas, pasajeros, rutas, plantillas), editor de rutas, programación, monitoreo y despacho, alertas e incidentes, CRM, cumplimiento, mantenimiento y combustible, conciliación y facturación, reportes, configuración.
- **App del chofer** (Android, Flutter): acceso con QR y PIN, revisión del celular antes del turno, pantalla de 3 botones, checklist con fotos, escaneo de gafetes y QR, modo sin señal, modo kiosco, ayuda.
- **Portal de la planta:** tablero en vivo con varias transportistas, evidencia por viaje, puntualidad, asistencia para RH, empleados por Excel, solicitudes, cumplimiento de proveedores, prefacturas, encuestas y quejas.
- **App del pasajero** (PWA): activación por número de empleado, ubicación del camión y ETA, credencial QR, avisos, calificación y quejas.
- **Consola de plataforma:** cuentas, suscripciones y cobro, salud de clientes y del sistema, tickets de nivel 3, prospectos, avisos, acceso de soporte con permiso.
- **Servicios automáticos:** programación, alertas, sincronización, diagnóstico, vencimientos, conciliación, notificaciones, reportes programados, monitoreo y respaldos, salud de clientes.
- **Ayuda y soporte:** ícono «?» por pantalla, centro de ayuda, asistente con datos de la cuenta (solo lectura), tickets por niveles.

## Usuarios
| Rol (código) | Dónde | Qué hace |
|---|---|---|
| owner, manager | Panel | Todo: configuración, usuarios, clientes, contratos, operación, facturación |
| planner | Panel | Rutas, paradas, horarios y programación |
| dispatcher | Panel | Asignación, monitoreo, alertas, incidentes, alta de choferes y PIN |
| billing | Panel | Conciliación, prefacturas, facturas y cobranza |
| maintenance | Panel | Unidades, servicios, combustible y documentos de unidades |
| driver | App del chofer | Sus viajes, checklist, escaneo, incidentes, pánico |
| plant_logistics | Portal | Tablero, evidencia, solicitudes, aprobación de prefacturas |
| plant_hr | Portal | Empleados, asistencia transportada, quejas |
| passenger | App del pasajero | Su ruta, ubicación del camión, credencial, avisos |
| platform_admin | Consola | Cuentas, suscripciones, salud del sistema, tickets de nivel 3 |

## Reglas clave
- Cada transportista es un tenant (tenant_id + RLS). Las plantas son organizaciones propias y ven viajes solo mediante service_agreements.
- Ubicación del chofer solo durante viajes; datos de pasajeros mínimos.
- Sin señal: todo se guarda en el celular y se envía en orden, sin duplicar ni perder.
- El viaje no inicia hasta que la revisión del celular esté en verde (o con excepción del despachador).
- Al escanear, la parada se asigna sola por cercanía; un gafete desconocido queda provisional y no detiene el viaje.
- Alertas: no iniciado, retraso, desvío, exceso de velocidad, parada no programada, sobrecupo, pánico, falla de checklist, unidad sin reportar (con causa probable), documento vencido. Escalan al gerente si nadie atiende.
- Vencimientos: avisos a 30, 15 y 5 días; bloqueo o advertencia al asignar.
- Conciliación: programado contra realizado (completo, con retraso, incompleto, cancelado, extraordinario), tarifas y penalizaciones, prefactura, objeciones, aprobación y CFDI en cola con reintentos.
- Notificaciones con respaldo: app → WhatsApp → SMS → correo.
- Las fallas de terceros y el cobro nunca detienen la operación; letrero automático y página de estado.
- No publicar versiones entre 4:00–8:00 ni 14:00–16:00 (cambios de turno); regreso automático si falla.

## Planes y precios (MXN por unidad al mes + IVA)
| Plan | Precio | Incluye |
|---|---|---|
| Esencial | $219 | App del chofer con revisión, abordaje QR o gafete, mapa en vivo, historial, alertas básicas, sin señal |
| Profesional (recomendado) | $379 | Lo anterior + portal de planta, diagnóstico, cumplimiento, conciliación y prefactura, solicitudes, cambios temporales, kiosco |
| Corporativo | $474 | Lo anterior + conexión con GPS existentes, app del pasajero completa, API, analítica, CFDI integrado, soporte prioritario |

- Unidad facturable: unidad con al menos un viaje en el mes.
- Igualación: 95% de lo que paga hoy (sin IVA contra sin IVA), piso $199, vigencia 12 meses; el cliente sube su factura y el administrador aprueba.
- Cálculo: precio especial vigente o de lista → piso $199 → descuentos → unidades × precio → mínimo $2,000 → IVA.
- Pago anual = 10 meses; contrato de 24 meses = 5% adicional; cambios de plan a mitad de mes se prorratean.
- Piloto: 60 días sin cobro mostrando «lo que costaría»; implementación $0.
- Plan «Planta» opcional: $1,500 al mes por planta. SMS incluidos hasta un límite por unidad; el excedente a costo.
- Cierre el último día del mes; factura el día 1.
- Morosidad: recordatorios días 1, 5 y 10; día 20 restringe solo funciones administrativas; día 45 suspensión programada con 5 días de aviso, nunca durante un turno.
- Modalidades: A reemplazo con celular, B conectado a su GPS, C todo incluido con socio GPS.

## Etapas del producto (DF §16)
- **Piloto:** catálogos, rutas, programación, app del chofer (revisión, escaneo, sin señal), monitoreo, alertas básicas, portal con evidencia y puntualidad, diagnóstico.
- **Versión 1:** QR y PIN, kiosco, centro de ayuda, tickets, cambios temporales, solicitudes, cumplimiento, conciliación y prefactura, página de estado, consola, respaldo de notificaciones.
- **Versión 2:** app del pasajero completa, asistente, CFDI integrado, mantenimiento y combustible, analítica, integraciones con RH y GPS, API.
