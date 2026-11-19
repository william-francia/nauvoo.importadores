# Paso 9A: publicado con operaciones deshabilitadas

## Resultado de la intervención autorizada — 11 de noviembre de 2026

Proyecto `vzpufrxjmdjjkikvpeev`: migraciones `20261103010000`, `20261103020000`, `20261103030000`, `20261103040000` y `20261103050000` aplicadas en orden, verificadas y registradas con el contenido exacto de los archivos. Publicados primero `siat-worker` v26 y después `siat-gateway` v31; ambos activos. 0600–0800 y `siat-local-ingest` quedaron excluidos.

Se conservaron los 18 secretos/configuraciones existentes y `SIAT_ANULACION_PILOTO_HABILITADA=false`. Ambiente PRUEBAS y `siat_habilitado=false`. La comparación de huellas de filas confirmó facturas, ventas, movimientos de inventario y cola sin cambios; cero tareas activas. Factura 1 SIN_RESPUESTA, retenida; factura 2 VALIDADA 908. Verificados RLS, permisos de las RPC, acceso restringido a evidencias SOAP y Storage privado. Worker rechaza POST sin credencial con 401; gateway responde OPTIONS con 204 y rechaza POST sin sesión con 401. No se ejecutó una operación fiscal ni se probó todavía una anulación ante el SIN.

Registro local de cada etapa y comprobación final: `C:\Users\Equipo\AppData\Local\Temp\nuvoo-9a-deploy-3f91ddaa12e94f05b99bec5887a6a188\migration-results.jsonl`, `function-results.jsonl` y `deployment-final-readonly.json`. Estos registros no contienen valores de secretos ni constituyen un respaldo de la base de datos.

Siguiente paso, con autorización fiscal separada: confirmar los datos de UNA factura piloto nueva, motivo oficial de anulación y destinatario real para la notificación privada; revalidar CUIS/CUFD y requisitos del preview al ejecutarla. Autorizar expresamente la activación piloto y esa prueba individual. Conservar respuesta oficial, evidencia cifrada y persistencia; detenerse ante rechazo o incertidumbre sin repetir automáticamente. Las facturas 1 y 2 siguen excluidas. Reversión y 9B permanecen bloqueados.

El procedimiento siguiente documenta el alcance utilizado; no autoriza su repetición ni la activación de operaciones. Las pruebas sintéticas anteriores no equivalen a pruebas fiscales oficiales.

## Prerrequisitos

1. La decisión del usuario es publicar por etapas en el proyecto actual, sin Docker ni staging. Esta propuesta sustituye la publicación conjunta de 9A+9B: solo comprende 0100–0500, gateway y worker. Mantener 9A y 9B deshabilitados durante la publicación y no afirmar que se probó Edge real.
2. Destino exclusivo: `vzpufrxjmdjjkikvpeev`. Confirmar historial, versiones y cola inmediatamente antes de publicar; detenerse ante tareas pendientes, reintentables o en ejecución cuyo procesamiento no esté controlado. No drenar, cancelar, reactivar ni cambiar tareas. Las facturas `c2279bbb-e851-468b-afe6-8ebf0b436d28` y `08dd889e-f2f7-4acb-be2e-2f911aae9919` quedan excluidas de toda operación. El usuario aplazó expresamente el respaldo: no hay recuperación de datos comprobada y un rollback de código no la sustituye.
3. Confirmar en el código y configuración del destino que `siat_habilitado`, las rutas de contingencia, la vinculación CAFC, la anulación y reversión permanecen deshabilitadas. No habilitar trabajadores de contingencia ni programaciones nuevas. No aplicar una migración ya registrada.

## Orden propuesto tras autorización expresa

1. Verificar base e historial y mantener `SIAT_ANULACION_PILOTO_HABILITADA=false`. Si faltan, crear únicamente `SIAT_SOAP_EVIDENCIA_KEY` (32 bytes aleatorios en base64 canónico) y `SIAT_NOTIFICACION_HMAC_KEY` (secreto aleatorio de al menos 32 caracteres), sin reemplazar claves existentes ni mostrarlas. No cambiar firma, token delegado, ambiente ni emisión comercial.
2. Aplicar exclusivamente, en este orden, `20261103010000_siat_paso9_operaciones_piloto.sql`, `20261103020000_siat_aislar_tareas_paso9.sql`, `20261103030000_siat_9a_evidencias.sql`, `20261103040000_siat_9a_correo.sql` y `20261103050000_siat_9a_soap_evidencia.sql`. Cada migración y su registro deben confirmarse atómicamente, con espera de bloqueo limitada. No usar un push indiscriminado de todas las pendientes. 0200 instala un filtro transitorio sin depender de 0300; 0300 crea sus tablas antes del filtro definitivo. 0400 conserva el orden y las RPC del gateway para notificación; no configura ni envía correo. No aplicar 0600–0800 en esta etapa.
3. Verificar registro, permisos/RLS, tablas de evidencias y trigger de cada etapa. Detenerse si falla una migración, aparece una incompatibilidad activa o se requiere una operación destructiva; conservar las etapas confirmadas sin deshacerlas automáticamente. No escribir facturas, ventas o inventario para comprobar la publicación.
4. Publicar `siat-worker` y después `siat-gateway`, con sus dependencias compartidas y XSD embebidos, vía API sin Docker. No publicar `siat-local-ingest`, agente ni otras funciones. El worker nuevo depende de 0200/0300; el gateway nuevo usa la RPC confirmada de 0100 y los servicios de evidencias de 0300–0500. CAFC continúa bloqueado antes de consultar su esquema y no requiere 0600–0800 para cargar el gateway.
5. Comprobar en lectura las versiones, bloqueos, autenticación/permisos, documentos existentes y cola. No invocar el worker como prueba: procesa tareas normales además de las de 9A. La interfaz local debe cargar el código actual; las pruebas con usuarios sin permiso no deben crear solicitudes fiscales. No invocar servicios del SIN ni crear tareas. La activación de anulación y la factura de prueba requieren autorización posterior separada.

## Compatibilidad y decisión de publicación

- La 0100 revoca el acceso de `service_role` a la RPC anterior de anulación/reversión. Se descargó en solo lectura el gateway publicado v29: su referencia a esa RPC está detrás del bloqueo incondicional de anulación y reversión; el gateway local usa la RPC confirmada. No se identificaron otros consumidores en el código local ni las dos funciones publicadas, pero no es posible descartar clientes externos con `service_role`. Mantener la revocación: la ruta anterior carece de las confirmaciones nuevas.
- La 0300 instala un trigger sobre actualizaciones de estado fiscal. Permite cambios que no entren en `ANULACION_PENDIENTE` o `REVERSION_PENDIENTE`; para esas transiciones exige destinatario privado pendiente. Verificar operaciones pendientes reales antes de aplicarlo.
- La transición de importadores 0600/0800 y la recuperación 0700 corresponden a 9B y quedan fuera de esta autorización. No cambian los contratos offline remotos durante la publicación de 9A.
- En la última consulta de funciones publicada para el proyecto vinculado solo figuraban `siat-gateway` v29 y `siat-worker` v24; no figuraba `siat-local-ingest`. Esto no descarta otros consumidores directos de las RPC ni sustituye la comprobación de la cola en el momento de publicar.
- 0100–0500 no borran ni reescriben registros fiscales históricos: crean objetos y cambian permisos, funciones y un trigger. El riesgo concreto es bloqueo breve por DDL o rechazo de un consumidor antiguo no identificado. El usuario acepta la ausencia de recuperación comprobada; no es autorización para cambios destructivos ni para publicar sin la aprobación específica de este conjunto.
- Corregido localmente el enlace faltante: después de la RPC confirmada, el gateway despacha el worker existente para `ANULACION_PENDIENTE`. Si falla el despacho, conserva la solicitud y muestra el fallo en la interfaz, sin repetir llamadas ni declarar éxito fiscal. Las solicitudes ya terminadas no despachan. La exclusión y los locks de la cola siguen a cargo de las RPC existentes.
- El worker anterior podría reclamar tareas antes de instalarse el nuevo filtro; el nuevo worker reclama tareas normales, no solo tareas nuevas. Confirmar cola, programaciones y actividad reales en el momento del despliegue; no activarlo ni invocarlo como prueba.

## Pruebas oficiales posteriores, siempre por autorización separada

Usar una factura piloto nueva expresamente autorizada, sin tocar las facturas piloto anteriores; registrar destinatario y confirmación administrativa antes de solicitar una única anulación. Conservar la respuesta oficial y tratar 905 con `transaccion=true` como evidencia de anulación; 906, fallos y respuestas ambiguas requieren evaluación y no provocan reenvío automático. No simular una notificación entregada. La reversión sigue bloqueada hasta verificar autorización oficial; probar 907/909 únicamente después de habilitación y autorización específica. Para 9B, solo ante evento y CAFC auténticos cuando correspondan, revisar CUFD, registro, recepción y resultado individual de paquetes y conciliación, con controles de duplicados y sin asumir aceptación global. Ninguna de estas pruebas forma parte de la publicación deshabilitada.

## Nombres de configuración

Supabase proporciona `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. Para 9A se reutilizan `SIAT_WORKER_SECRET`, `SIAT_ALLOWED_ORIGINS`, `SIAT_PRIVATE_KEY_PEM`, `SIAT_CERTIFICATE_PEM` y `SIAT_TOKEN_DELEGADO`, sin modificarlos. Se requieren las dos claves nuevas de evidencia y notificación indicadas arriba; `SIAT_ANULACION_PILOTO_HABILITADA` permanece en `false`. No configurar agente ni correo automático en esta publicación. Correo automático, solo en una fase posterior autorizada: `RESEND_API_KEY`, `SIAT_EMAIL_FROM`.

La última consulta de nombres confirmó `SIAT_WORKER_SECRET` y `SIAT_ALLOWED_ORIGINS`; no figuraban las dos claves nuevas ni el interruptor. Solicitar en una sola autorización las cinco migraciones, las dos funciones y esa configuración limitada. La primera prueba podrá usar notificación manual con destinatario real y evidencia de envío, sin proveedor de correo automático.

## Ante un fallo

Detener la secuencia y conservar logs sanitizados, historial y estado de cola. No reintentar operaciones fiscales ni efectuar rollback destructivo automático. Comparar migraciones efectivamente registradas y versiones publicadas; preparar una corrección progresiva o una recuperación desde copia verificada y solicitar autorización antes de ejecutarla.
