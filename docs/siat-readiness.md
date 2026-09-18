# Readiness SIAT

Fecha: 2026-09-17. Alcance: compra/venta de ferretería, pruebas, `SIAT_VIGENTE`.

| Control | Estado |
|---|---|
| Emisión online, conciliación, anulación y reversión | IMPLEMENTADO |
| Contingencia automática y venta sin Supabase mediante agente local | IMPLEMENTADO |
| Multi-caja, numeración, idempotencia e inventario | IMPLEMENTADO |
| Eventos, TAR/GZIP, recepción y validación 901/904/908 | IMPLEMENTADO |
| CAFC separado con evidencia | IMPLEMENTADO |
| RLS, storage privado, secretos backend y logs sanitizados | IMPLEMENTADO |
| Backup cifrado y restauración reanudable | IMPLEMENTADO Y PROBADO LOCALMENTE |
| Migraciones en proyecto remoto | PENDIENTE DE APLICACIÓN CONTROLADA |
| Suite oficial SIN | BLOQUEADO_POR_CREDENCIALES_O_AUTORIZACION_SIN |
| Piloto/autorización externa | BLOQUEADO_POR_AUTORIZACIÓN_DEL_SIN |

Estado real: **LISTO PARA PRUEBAS SIAT**, condicionado a desplegar, registrar el agente y proporcionar credenciales/autorización. No está listo para producción.

No aplicable: emisión masiva sin autorización; Ley 1733 sin piloto; sectores distintos de Compra y Venta. Nota crédito/débito queda extensible, no asumida.

Antes del piloto se requieren actas reales de CUIS/CUFD, emisión, anulación/reversión, eventos, paquetes válidos/observados, corte total con dos cajas y restauración sin duplicados.
