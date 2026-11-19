# Prueba individual de anulación 9A: tercera factura piloto

Preparación local del 11/11/2026. No autoriza publicación ni llamadas fiscales. Proyecto previsto: `vzpufrxjmdjjkikvpeev`, exclusivamente PRUEBAS, `siat_habilitado=false`. Las facturas 1 y 2 quedan excluidas.

## Corrección mínima y publicación posterior autorizada

1. Confirmar en lectura proyecto, ambiente, cola vacía, facturas protegidas y migraciones 0100–0500 aplicadas. Mantener `SIAT_ANULACION_PILOTO_HABILITADA=false`.
2. Aplicar únicamente `20261103055000_siat_9a_tercera_factura_piloto.sql` y registrar su versión en una misma transacción. No editar las migraciones aplicadas ni incluir 0600–0800. La nueva columna nullable conserva autorizaciones históricas; el índice parcial admite una única autorización PREPARADA/CONSUMIDA con propósito `ANULACION_9A`. Las RPC existentes conservan permisos y validaciones.
3. Comprobar en lectura etapa 2, permisos de servicio y ausencia de cambios en facturas, numeración, ventas, inventario y cola. La migración no habilita emisión ni prepara una autorización.
4. Publicar solamente `siat-gateway` con su dependencia compartida `pilot-preview.ts`, usando el empaquetado 9A existente. Conservar el worker v26; no publicar local-ingest, 9B ni otras funciones. Recargar el frontend local actual para mostrar la etapa 9A y la confirmación de identidad. Comprobar preview sin preparar ni emitir hasta la autorización fiscal.

## Secuencia fiscal, solo después de autorización expresa

1. Confirmar comprador: CLI-000006, William Benjamin Francia Poma, CI 9204357 sin complemento. Fixture ph1234, cantidad 1, precio Bs 5, descuento Bs 0, total Bs 5, efectivo SIN 1, actividad 4752100, producto SIN 1003451, unidad 47. Confirmar que el comprador dispone de un WhatsApp real y acepta ese canal; no solicitar su número en el chat ni inventarlo.
2. Desde Configuración SIAT, solicitar CUFD una sola vez mediante `request-cufd`. La ruta existente valida PILOTO y CUIS y no renueva si ya existe CUFD vigente. Verificar la respuesta y vigencia del mismo ambiente/sucursal/PV; encolar no demuestra renovación. Ante error, detenerse.
3. En la vista piloto, pulsar **Ver preview piloto**, confirmar comprador e importes, **Confirmar precio y preparar autorización individual (no emite)** y **Habilitar esta autorización (no emite)**. Preparar la autorización justo antes de usarla: el vencimiento no se salta ni se reemplaza automáticamente. Su hash y propósito son distintos de las dos anteriores.
4. Confirmar y emitir UNA factura. La RPC reserva un número nuevo atómicamente y usa fecha nueva; el motor existente genera su CUF y XML. El preview no reserva nada. Registrar el UUID resultante y comprobar `VALIDADA`, código 908, `transaccion=true`, recepción y documentos persistidos antes de continuar. Rechazo, timeout o respuesta incierta detienen la secuencia; no repetir emisión ni crear otra autorización.
5. Abrir exclusivamente esa factura en Gestión de facturas → detalle → **Notificación privada**. Elegir **Preparar destinatario para anulación**, canal **WhatsApp manual**, introducir privadamente el número real, declarar que corresponde al comprador y pulsar **Preparar destinatario**. El registro queda PENDIENTE y protegido; no representa un envío. La interfaz existente permite este registro después de validar la factura y antes de anularla.
6. Confirmar elegibilidad, plazo, ausencia de reversión previa, declaración administrativa de que no se utilizó en DDJJ y motivo oficial 1 vigente. Comprobar que no existe otra tarea fiscal activa. Fijar el UUID de esta factura y un solo identificador idempotente para la operación.
7. Abrir una ventana supervisada: cambiar únicamente `SIAT_ANULACION_PILOTO_HABILITADA` a `true`, comprobar el control efectivo y solicitar UNA anulación de ese UUID mediante la interfaz/RPC existente. El interruptor es global para anulación PILOTO, no una concesión por UUID: el aislamiento de esta prueba depende además de la autorización única, la cola vacía, las dos facturas excluidas y no operar desde otras sesiones durante la ventana. Reversión, 9B y emisión comercial siguen bloqueadas.
8. Al terminar o ante cualquier error, cerrar la ventana con `SIAT_ANULACION_PILOTO_HABILITADA=false` y verificar tanto configuración como capacidades del gateway. Esta restauración requiere la intervención supervisada; no se presume un temporizador automático. Conservar respuesta SOAP cifrada, intento, auditoría y estado oficial. No reactivar tareas ni repetir anulación. Si queda una conciliación pendiente, mantenerla sin ejecutar hasta revisar el resultado y autorizarla.
9. Solo si se confirma la anulación, el administrador envía manualmente el aviso generado al WhatsApp declarado y conserva el comprobante. **Registrar envío manual de anulación** requiere destinatario, fecha y referencia verificable; no marcar ENVIADA por copiar texto o abrir WhatsApp. Registrar entrega únicamente con acuse real.

## Validación local focalizada

- PostgreSQL nativo aislado: migración aplicada atómicamente; permisos, propósito incorrecto, producción, CUFD vencido y segunda autorización bloqueados.
- Dos solicitudes concurrentes y un reintento devuelven el mismo UUID: una tercera factura, un trabajo de cola, número nuevo, fecha nueva, CUF/XML inicialmente vacíos para el motor; cuarta factura bloqueada.
- Huellas de las dos facturas sintéticas anteriores sin cambios, cero ventas y cero movimientos de inventario.
- Reutiliza `tests/siat/third-pilot-local.sql` y `tests/siat/third-pilot-concurrency.mjs`, restringidos al clúster local sintético. No equivalen a una respuesta oficial del SIN ni a una prueba Edge remota.
- Resultado final: 9/9 pruebas de `pilot-preview.test.ts`, `npm run typecheck`, lint de los cinco archivos TypeScript afectados y `git diff --check` aprobados. No se repitió la suite general.

Ante fallo de publicación, detenerse y conservar lo confirmado. No deshacer datos ni cambiar permisos para continuar. El gateway anterior mantiene la tercera etapa bloqueada hasta publicar la corrección; no se necesita alterar facturas históricas para recuperar ese bloqueo.
