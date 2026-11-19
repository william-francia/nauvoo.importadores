# Kit SIAT reutilizable — entrega técnica de NUVOO

Fecha de corte: 19 de noviembre de 2026. Este documento describe el código existente y el estado comunicado y comprobado durante el trabajo previo. Esta entrega documental no vuelve a consultar Supabase ni al SIN, no libera reservas y no habilita operaciones. No constituye autorización de producción.

## 1. Qué se construyó

La numeración de pasos procede del proceso de trabajo; los primeros pasos se agrupan aquí según sus artefactos verificables, sin atribuirles pruebas oficiales adicionales.

| Etapa | Implementación y evidencia en el repositorio | Alcance de la conclusión |
|---|---|---|
| 1–3: base, servicios y contingencia | Migraciones `20260916*`–`20260918*`, contratos WSDL, `official-vigente.adapter.ts`, repositorio, cola y agente | Implementación; no equivalen a homologación del sistema |
| 4–6: documento y firma | `cuf.ts`, `invoice-xml.ts`, `signature-credentials.ts`, `xmldsig.ts`, XSD oficiales y pruebas | CUF, XML, firma real, validación y controles de credenciales desarrollados |
| 7: recepción piloto | Motor, autorización individual, SOAP, outbox, persistencia y conciliación | Factura piloto 2 con 908 VALIDADA, según resultado oficial previamente comprobado |
| 8: representación y entrega | `fiscal-document.ts`, `fiscal-pdf.ts`, `qr.ts`, `document-access.ts`, servicios de descarga | Carta, rollos 80/58 mm, QR, consulta fiscal y XML firmado original |
| 9A: anulación y reversión | `fiscal-operation.ts`, evidencias, notificaciones y migraciones 0100–0500 | Factura piloto 3 anulada con 905; reversión real aún pendiente |
| 9B: contingencia digital | Agente, local-ingest, recuperación, paquetes, conciliación, numeración compartida | Circuito simulado y aprovisionamiento; prueba fiscal integral oficial pendiente |
| 10: entrega reutilizable | Esta guía y `scripts/exportar-siat-kit.ps1` | Documentación, exportación controlada y cierre en Git; sin nuevas funciones fiscales |

### Estado operativo que debe conservarse

- Factura 1: SIN_RESPUESTA, outbox CANCELADA/retenido. No reenviar por iniciativa del sistema.
- Factura 2: VALIDADA, respuesta oficial 908, XML firmado, CUF y recepción persistidos.
- Factura 3: ANULADA, respuesta oficial 905. WhatsApp manual pendiente: no registrar ENVIADA sin evidencia. La reversión no está oficialmente probada ni habilitada por esta entrega.
- Agente PILOTO conectado y aprovisionado, sucursal 0/PV 0. Número **4 reservado, sin emitir**. La reserva abierta mantiene pausada la asignación online del mismo ámbito. No cerrarla, liberar ni reutilizarla desde el kit.
- Emisión comercial general y operaciones fiscales 9B deshabilitadas; CAFC separado y bloqueado. La anulación temporal volvió a deshabilitarse tras la prueba.
- Sigue pendiente un evento auténtico o procedimiento de prueba expresamente admisible, su evidencia, vigencias fiscales y homologación del producto utilizado antes de la prueba oficial de contingencia. No se declara aprobado ese ensayo.

## 2. Arquitectura y dependencias

```text
Frontend React / otro sistema comercial
  -> siat-gateway (sesión Supabase + usuario/rol + autorización)
  -> repository + RPC PostgreSQL (factura, numeración, auditoría, outbox)
  -> siat-worker -> engine -> adaptador vigente -> cliente SOAP -> SIN

Frontend local -> agente Node/TypeScript -> almacén SQLite cifrado
  -> siat-local-ingest (HMAC, timestamp, nonce, agente/ámbito)
  -> RPC de importación idempotente -> PostgreSQL -> outbox/worker
  -> registro de evento -> paquetes -> validación y conciliación individual
```

`engine.ts` coordina; `repository.ts` implementa persistencia Supabase; `types.ts` define contratos. `official-vigente.adapter.ts` transforma contratos de dominio en SOAP. `soap.ts` maneja transporte, Fault y captura de respuesta. `runtime.ts` carga configuración y autentica usuarios; nunca colocar credenciales de servicio en React.

La factura fiscal no es una segunda venta: se enlaza a la venta original mediante identificadores e idempotencia. La autorización y los cambios de estado son transaccionales en PostgreSQL. La reserva digital comparte protección con la numeración online. Anular fiscalmente no implica devolver stock ni registrar otro pago.

## 3. Mapa de archivos

| Rutas reales | Responsabilidad | Portabilidad |
|---|---|---|
| `supabase/functions/_shared/siat/engine.ts`, `repository.ts`, `types.ts`, `runtime.ts` | Orquestación, persistencia y contratos | Motor reutilizable; adaptar tablas, perfiles y configuración |
| `official-vigente.adapter.ts`, `soap.ts`, `ley1733.adapter.ts` | Contratos y transporte; adaptador histórico separado | Usar versión normativa configurada, no asumir equivalencia del histórico |
| `cuf.ts`, `invoice-xml.ts`, `money.ts`, `encoding.ts`, `tar.ts` | Cálculos y serialización fiscal | Reutilizables con datos/ámbitos correctos |
| `signature-credentials.ts`, `xmldsig.ts`, `xsd.ts`, `xsd-embebidos.ts` | PKCS#8/X.509, XMLDSig y XSD | Adaptar comprobaciones de titular del piloto; no deshabilitarlas |
| `artifacts/SIAT_VIGENTE/` dentro de `_shared/siat` | WSDL, XSD y manifiesto de contratos | Conservar versiones y hashes; no sustituir por contratos inventados |
| `fiscal-document.ts`, `fiscal-pdf.ts`, `brand-logo.ts`, `qr.ts`, `document-access.ts` | Snapshot fiscal, PDF, marca, URL/QR y permisos | Marca y presentación son específicas de NAUVOO |
| `fiscal-operation.ts`, `fiscal-soap-evidence.ts`, `notification-*`, `immutable-artifact.ts` | Anulación/reversión, evidencia y entrega privada | Integrar proveedor y permisos reales; no simular envíos |
| `contingency-controls.ts`, `cafc-document.ts`, `cafc-link-control.ts`, `contingency-probe.ts` | Eventos, separación CAFC, controles y sonda nonce | Mantener bloqueos de requisitos externos |
| `pilot-preview.ts`, `pilot-approval.ts`, `signature-test.ts` | Pruebas piloto acotadas | Específicos de NUVOO; no habilitar en otra empresa sin adaptación |
| `supabase/functions/siat-{gateway,worker,local-ingest,maintenance}/index.ts` | Entradas Edge y mantenimiento | Autenticación distinta por función; no eliminar verificaciones |
| `agent-local/src/{app,server,remote,store,state-machine,fiscal,security,config,types}.ts` | Servicio local, persistencia, firma, red y recuperación | Adaptar servicio de inicio y almacén seguro al sistema operativo |
| `agent-local/src/{contingency-safety,manual-cafc,manual-cafc-form}.ts` | Control digital y transcripción manual separada | CAFC no se habilita por instalar estos archivos |
| `src/features/facturas/`, `src/pages/facturas/` | Configuración, documentos, contingencia y administración | Componentes dependen del shell, Auth, estilos y servicios de NUVOO |
| `src/features/ventas/`, `src/lib/supabase.ts` | Venta confirmada, precio histórico y acciones fiscales | Capa comercial específica; usar como referencia, no reemplazar otra app entera |
| `tests/siat/`, `tests/agent/`, `tests/fixtures/` | Pruebas sintéticas e integración local | No confundir fixtures ni simulador con evidencia oficial |

## 4. Exportación segura

Desde la raíz del repositorio:

```powershell
powershell -NoProfile -File .\scripts\exportar-siat-kit.ps1
# Opcional: elegir una carpeta NUEVA fuera del repositorio
powershell -NoProfile -File .\scripts\exportar-siat-kit.ps1 -Destino C:\Entregas\SIAT-Kit-nuevo
```

El script sólo lee la lista explícita de fuentes y crea una carpeta nueva. No instala, despliega, usa credenciales, consulta servicios ni ejecuta SQL. Rechaza destinos existentes o dentro del repositorio y rutas enlazadas. Genera `INSTALACION.md` y `MANIFEST-SHA256.json`; cada archivo exportado se verifica por hash.

Se excluyen `.env` reales, `.siat-agent`, `output`, `.git`, `node_modules`, respaldos, logs, estado del agente, scripts operativos remotos y secretos. Sólo `.env.example` puede exportarse. No se exporta la migración de prueba que escribe un producto de demostración.

Hay valores del piloto incorporados en código y SQL históricos. Para no entregar datos personales, **sólo en las copias** se sustituyen nombre/documento/código de cliente, NIT de prueba y correos por marcadores; los UUID literales se sustituyen consistentemente por identificadores de ejemplo derivados. El manifiesto indica qué archivos fueron adaptados. No se exporta la tabla de correspondencias. Los originales de NUVOO no se modifican.

El resultado es un **kit de fuentes para adaptación**, no un proyecto instalable con un solo clic. No ejecutar los SQL anonimizados sobre una base existente: los marcadores de identidad deliberadamente no autorizan un contribuyente o cliente real. Las rutas de pruebas piloto y las protecciones ligadas a IDs históricos deben adaptarse o dejarse inaccesibles. El frontend se entrega como referencia de integración: faltan los componentes comerciales y de navegación ajenos a la lista permitida.

## 5. Instalación y migraciones: orden y condiciones

1. Preparar el sistema destino, su autenticación y modelo comercial. `supabase/migraciones/20260908120000_initial_schema.sql` es un snapshot histórico de `public`; `20260908130000_clientes_integracion.sql` completa clientes. **No son un instalador universal**: el snapshot lista algunas FK antes de PK; el validador sintético del repositorio las reordena en memoria. Para una empresa nueva preparar un baseline equivalente revisado, sin copiar datos. Supabase aporta `auth`, `storage` y roles, que un PostgreSQL simple no trae.
2. Conservar `package.json` y `package-lock.json` como inventario reproducible. `npm ci` instala las versiones bloqueadas; Node debe satisfacer los `engines` de las dependencias. No hace falta Docker para compilar/testear TypeScript. El import map Edge resuelve dependencias `npm:`. No sustituir versiones de XML/crypto/WASM sin pruebas.
3. Adaptar el repositorio/RPC al baseline comercial, antes de aplicar migraciones. Comparar historial remoto; nunca reaplicar versiones existentes. En una instalación nueva revisada, respetar el orden de la tabla siguiente.
4. Configurar secretos propios, permisos, buckets privados y origen permitido. Instalar agente sin datos de NUVOO. No aprovisionar ni reservar por ejecutar `npm ci` o arrancar la interfaz.
5. Publicar sólo funciones compatibles con el esquema, con operaciones inicialmente deshabilitadas; actualizar agente/frontend de forma coordinada. Probar primero lectura/autenticación y luego escrituras aisladas autorizadas. Activar fiscalidad sólo después de requisitos y pruebas oficiales.

| Orden/versiones de `supabase/migrations/` | Dependencia/precaución |
|---|---|
| `20260908130000` | RPC registrar venta; requiere baseline comercial |
| `20260916203000`, `20260917200000`, `20260917300000` | Base SIAT, motor online, contingencia y agente |
| `20260918100000`, `20260918173000` | Usuarios/roles/permisos y productos; adaptar bootstrap administrativo |
| `20260918180000`, `20260918181000`, `20260918182000` | Catálogos, deduplicación y numeración segura |
| `20260922210000`, `20260923120000` | RPC inventario/ventas; específicas del modelo comercial |
| `20261023010000`, `20261023013000`, `20261023014000` | Piloto aislado, sincronización y snapshot de descripción |
| `20261023020000`, `20261023023000`, `20261023030000` | Evidencias NIT/certificado, CI y declaración verbal piloto |
| `20261030020000`, `20261030030000` | Segundo piloto acotado y protección del XML |
| `20261103010000` → `20261103020000` → `20261103030000` → `20261103040000` → `20261103050000` | 9A: autorización, aislamiento de cola, evidencias, correo y SOAP cifrado |
| `20261103055000` | Tercer piloto de anulación; específico de NUVOO |
| `20261103060000` → `20261103070000` → `20261103080000` | Importación idempotente v2, confirmación de recuperación, vínculo CAFC/venta existente |
| `20261113010000_siat_numeracion_compartida.sql` | Protección conjunta digital online/offline, liberación controlada; requiere cadena anterior y comprobar reservas/ámbito |

La versión `20260918175000_prueba_persistencia_producto.sql` es una prueba comercial, no parte de la instalación portable. Se excluye, sin alterar el historial original. Para 0200/0300, conservar la transición ya implementada: la reclamación intermedia no exige prematuramente las tablas que 0300 crea. 0300 debe preceder a sus consumidores definitivos; 0500 necesita intentos/evidencias previos. No restaurar permisos de RPC antiguas para resolver incompatibilidades.

La cadena depende de ventas, clientes, productos, detalle, pagos, inventario y usuarios de NUVOO. En otro sistema se necesitan adaptadores explícitos. No ejecutar `supabase db push` indiscriminadamente, ni confundir revertir código con recuperar datos SQL.

## 6. Configuración (nombres, nunca valores)

| Ubicación | Variables |
|---|---|
| Frontend público | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SIAT_AGENT_URL` |
| Edge/Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (sólo servidor), `SIAT_ALLOWED_ORIGINS` |
| SIN | `SIAT_TOKEN_DELEGADO`, `SIAT_PRIVATE_KEY_PEM`, `SIAT_CERTIFICATE_PEM`, `SIAT_CODIGOS_URL`, `SIAT_SINCRONIZACION_URL`, `SIAT_OPERACIONES_URL`, `SIAT_COMPRA_VENTA_URL`, `SIAT_TIMEOUT_MS` |
| Worker/mantenimiento | `SIAT_WORKER_SECRET`, `SIAT_SCHEDULER_SECRET` |
| Evidencia 9A | `SIAT_SOAP_EVIDENCIA_KEY` (32 bytes en base64 canónico para AES-GCM), `SIAT_NOTIFICACION_HMAC_KEY` |
| Activación restringida | `SIAT_ANULACION_PILOTO_HABILITADA`, `SIAT_CONTINGENCIA_PILOTO_HABILITADA`, `SIAT_CONTINGENCIA_AGENTE_CODIGO`, `SIAT_CONTINGENCIA_AMBIENTE` |
| Agente | `SIAT_AGENT_CODE`, `SIAT_AGENT_SHARED_SECRET`, `SIAT_AGENT_STORAGE_KEY`, `SIAT_AGENT_RESERVA_CANTIDAD`, `SIAT_AGENT_DEFAULT_EVENT_CODE` |
| Red/almacén local | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SIAT_AGENT_INGEST_URL`, `SIAT_AGENT_HOST`, `SIAT_AGENT_PORT`, `SIAT_AGENT_DATA_DIR`, `SIAT_AGENT_ALLOWED_ORIGINS`, `SIAT_AGENT_SESSION_HOURS` |
| Correo opcional | `RESEND_API_KEY`, `SIAT_EMAIL_FROM`; sin proveedor/consentimiento no enviar |

La clave compartida y la clave local requieren al menos 32 caracteres según `loadConfig`. El cifrado SOAP usa clave separada y AAD por factura/operación/intento; conservar su identificación y acceso restringido. No reutilizar claves de NUVOO. La clave pública del frontend no reemplaza el contrato HMAC del agente ni una credencial administrativa. Los valores fiscales de configuración (NIT, modalidad, ambiente, código de sistema, sucursal y PV) se guardan mediante el mecanismo administrativo/RPC existente; `siat_habilitado` permanece falso inicialmente.

## 7. Adaptación a otra empresa y sistema comercial

- Sustituir emisor, NIT, razón social, actividad, sucursal/PV, ambiente y código de sistema por datos autorizados; configurar endpoints de PILOTO antes de considerar producción.
- Instalar certificado/clave propios, verificar vigencia, correspondencia, usos y aceptación del perfil. La evidencia administrativa del certificado piloto de NUVOO no se transfiere. CUIS/CUFD corresponden al ámbito y vigencia reales, nunca se copian.
- Homologar productos, actividad, unidad, documento y pago contra catálogos vigentes. No deducir origen nacional/importado de una descripción. El fixture de piloto no homologa inventario de otra empresa.
- Adaptar `repository.ts` y RPC a IDs de venta/producto/cliente estables. Mantener precio final confirmado, descuentos y totales como snapshot; no recalcular documentos históricos con el catálogo actual.
- Confirmar comercialmente una sola vez. Emitir/importar debe referenciar esa venta, no recrear pagos/stock al recuperar conexión. Los consumidores v1 y v2 tienen contratos distintos; actualizar agente e ingest juntos según sus rutas existentes.
- Mapear perfiles/roles de `usuarios` al Auth destino, conservar RLS, autorización individual, almacenamiento privado y auditoría. Eliminar exposición de rutas piloto específicas mediante adaptación autorizada, no deshabilitando seguridad.
- Cambiar logo, textos de emisor y shell React. Conservar campos fiscales, representación de importes, URL/QR construidos por `qr.ts` y descarga de bytes del XML persistido.

## 8. Pruebas mínimas y límites de evidencia

En el repositorio completo, antes de habilitar:

```text
npm run typecheck
npm run typecheck:agent
npx vitest run tests/siat/contingency-integral.test.ts tests/siat/phase9b-recovery.test.ts tests/agent/number-reservation.test.ts
npm run build
git diff --check
```

Para una integración nueva añadir los grupos existentes de XML/firma/XSD, permisos/documentos, SOAP, numeración concurrente, 9A y agente. Las pruebas SQL y de concurrencia requieren PostgreSQL **aislado**, schema equivalente y configuración local explícita. Los scripts `*-local` tienen guardas y rutas del entorno original; no apuntarlos a la empresa real ni ejecutarlos sin adaptación. El kit no incluye sus credenciales ni instala infraestructura.

La prueba integral local sustituye SIN por un simulador. La sonda nonce positiva comprueba HMAC, persistencia y rechazo de reutilización en Edge/RPC/PostgreSQL, **no** emisión offline ni aceptación fiscal de un paquete. Después se necesitan pruebas operativas autorizadas, con vigencias, producto homologado, evento válido y respuestas oficiales persistidas; no inferir aceptación de un HTTP 200 ni de una respuesta parcial.

Los resultados de esta entrega se registran en el informe del commit/ejecución. Los recuentos históricos (incluida la batería de 262) no significan que se haya vuelto a ejecutar toda la suite ahora.

## 9. Problemas conocidos y soluciones existentes

| Problema | Solución existente / precaución |
|---|---|
| SOAP `fechaEnvio` con `Z` | `siatDateTime` y hora Bolivia con milisegundos; no cambiar la fecha del XML histórico |
| PEM/runtime y error genérico | Normalización y errores por etapa en `signature-credentials.ts`; importación PKCS#8 y verificación real, sin OpenSSL obligatorio en Edge |
| XSD ausente en bundle | `xsd-embebidos.ts` generado desde artifacts por `scripts/generar-xsd-siat.mjs`; conservar validación |
| CORS en `127.0.0.1` vs `localhost` | Usar origen permitido y URL coherente; no abrir CORS indiscriminadamente |
| Sesión local no persiste | Frontend y agente con el mismo hostname y puertos previstos; revisar cookies/orígenes permitidos |
| UUID `undefined` en ingest | Método de CUIS por ámbito separado como `activeCuisForScope`; conservar el método basado en configuración para sus consumidores |
| Respuesta incierta y duplicación | Retención, idempotencia y conciliación; no reenviar ciegamente ante timeout/Fault |
| Numeración solapada | RPC compartida y transaccional, pausa online por reserva, recuperación/liberación auditadas; CAFC separado y bloqueado |
| Evento remoto sin facturas | Finalización local auditable y sin paquete vacío; no inventar cierre remoto SIN |
| Notificación falsa | Copiar texto/abrir WhatsApp no demuestra envío; registrar evidencia y estado real |

## 10. Pendientes antes de producción

Prueba oficial de contingencia digital pendiente; homologación efectiva del producto de la prueba; requisitos y habilitación de reversión pendientes; CAFC sólo con autorización/documentación válida. Falta completar las pruebas oficiales aplicables y autorización del SIN para el sistema/empresa destino, además de operación segura (secretos propios, acceso, recuperación y despliegue verificados). La notificación manual de la anulación piloto sigue pendiente.

El commit es una fotografía del desarrollo local, no prueba que todos sus archivos coincidan con cada versión Edge publicada. No se publica nada en esta entrega. No afirmar que el número reservado está conciliado o que la emisión online está desbloqueada mientras siga abierta la reserva.
