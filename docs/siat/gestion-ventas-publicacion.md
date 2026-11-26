# Gestión de ventas y documentos SIAT: publicación verificada

Rama: `feature/siat-gestion-ventas`. Publicación autorizada realizada el 25/11/2026 en `vzpufrxjmdjjkikvpeev`. No autoriza operaciones fiscales ni envíos reales de correo.

## Estado publicado

- Aplicadas en orden y registradas en `supabase_migrations.schema_migrations`: `20261124010000_siat_entrega_correo_factura.sql` y `20261125010000_producto_actividad_economica.sql`. Cada archivo se ejecutó en una transacción junto con su registro de versión y contenido, con límites de espera de bloqueo y ejecución. No se utilizó `db push`.
- Gateway **v39 ACTIVE**, `verify_jwt=true`. Worker **v31** y local-ingest **v6** sin modificaciones.
- Configuración comprobada: **PRUEBAS**, actividad **4752100**, `siat_habilitado=false`.
- Verificado: tabla de correo vacía, RLS habilitada, RPC de reserva restringida a `service_role`, ambos triggers de actividad habilitados y permiso de lectura de la columna para `authenticated`.
- Permanecen tres productos y once ventas; ningún producto histórico reclasificado. Las tres facturas conservan sus identificadores, estados y huellas del CUF (SIN_RESPUESTA, VALIDADA, ANULADA).
- Gateway responde OPTIONS **204** con CORS para `http://localhost:5173`; petición sin sesión rechazada **401**, como corresponde. Esto no sustituye una prueba de las acciones con sesión administrativa.
- Vite responde **200** en `http://localhost:5173`. El control del navegador no estuvo disponible: queda pendiente comprobar visualmente las consultas con la sesión del usuario.
- Correo pendiente: configurar privadamente `RESEND_API_KEY` y `SIAT_EMAIL_FROM`, con dominio/remitente verificados. `SIAT_NOTIFICACION_HMAC_KEY` ya existe y no se sustituyó. No se enviaron correos.

## Recuperación y límites

Las migraciones son aditivas y no actualizan filas históricas. Un fallo dentro de cada transacción revierte esa transacción, no las etapas anteriores ya confirmadas. Después de publicar, detener nuevas pruebas ante una regresión; no eliminar tablas/columnas ni modificar el historial automáticamente. Conservar los datos nuevos y preparar una corrección compatible. El código anterior del gateway se descargó para revisión antes de publicar; volver a una versión de código no restaura datos. No hay una restauración de base de datos comprobada por esta intervención.

## Dependencias y configuración

- Proyecto previsto: `vzpufrxjmdjjkikvpeev`, ambiente `PRUEBAS` (PILOTO). Confirmar el proyecto y el estado de las funciones antes de intervenir.
- La consulta de facturas desde Ventas usa las tablas y políticas existentes de `ventas`, `facturas_siat`, `clientes`, `usuarios` y `siat_auditoria`. No requiere una venta nueva ni una migración para mostrarlas.
- Anulación y reversión usan `cancel`, `reverse`, el catálogo `MOTIVOS_ANULACION`, las capacidades 9A, el worker y la RPC 9A publicados. Sus interruptores y requisitos fiscales siguen vigentes. `REVERTIDA` es el estado persistido tras una reversión oficial; la tabla lo muestra como «VALIDADA (revertida)» sin perder la evidencia de reversión.
- El envío de factura por correo requiere proveedor configurado: `RESEND_API_KEY`, `SIAT_EMAIL_FROM` y `SIAT_NOTIFICACION_HMAC_KEY` (mínimo 32 caracteres). Revisar solo la presencia de los nombres; no imprimir ni reemplazar valores. Confirmar remitente y dominio autorizados por el proveedor. Sin proveedor, el botón informa que no está disponible.
- PDF/XML/consulta oficial se habilitan para documentos PILOTO con validación original 908, transacción verdadera, recepción, CUF, XML firmado y hash íntegro. Los PDF de `ANULADA` llevan marca de agua. Producción permanece sin URL de consulta verificada en el código.

## Procedimiento de referencia (ya ejecutado; no repetir)

1. Revisar cambios pendientes y las migraciones aplicadas en el proyecto indicado. **No ejecutar `supabase db push`**: aplicaría otras migraciones pendientes. El orden autorizado fue correo (`20261124010000`) y actividad de productos (`20261125010000`), antes del gateway. La primera crea registro privado de intentos y dos RPC restringidas a `service_role`; la segunda incorpora la actividad de nuevos productos y su coherencia con la homologación, sin inventar clasificación SIN. Los archivos siguientes son referencia para revisión, no deben ejecutarse nuevamente:

   ```powershell
   Get-Content -LiteralPath '.\supabase\migrations\20261124010000_siat_entrega_correo_factura.sql' -Raw -Encoding UTF8 | Set-Clipboard
   ```

   Después, comprobar en SQL Editor con una consulta de lectura:

   ```sql
   SELECT to_regclass('public.siat_documento_correos') AS tabla,
          to_regprocedure('public.siat_reservar_correo_documento(uuid,uuid,uuid,text,text,boolean)') AS reserva,
          to_regprocedure('public.siat_finalizar_correo_documento(uuid,uuid,text,text)') AS cierre;
   ```

2. Publicar **solo** `siat-gateway` desde esta rama. El gateway ya usa el import map y `verify_jwt=true` configurados en `supabase/config.toml`. No publicar worker ni local-ingest:

   ```powershell
   .\node_modules\@supabase\cli-windows-x64\bin\supabase.exe functions deploy siat-gateway --project-ref vzpufrxjmdjjkikvpeev --use-api --import-map supabase/functions/import_map.json
   ```

3. Verificar la versión publicada, acceso administrativo, permisos, CORS, lectura de facturas y botones de documentos; comprobar que ventas y 9A continúan operativos. No activar interruptores fiscales para comprobar la vista ni enviar correos de prueba a destinatarios reales.
4. El frontend usa Vite local. Si el servidor se detuvo, ejecutar `npm run dev -- --host localhost --port 5173 --strictPort` y abrir `http://localhost:5173` → Ventas → Gestión de ventas. Pulsar **Actualizar** y comprobar facturas piloto 1, 2 y 3, estados, ambientes y acciones de lectura. Para PDF de la factura 3 comprobar la marca «ANULADO» en carta y ambos rollos. Abrir Productos → Nuevo producto y comprobar la actividad 4752100 bloqueada; registrar un producto requiere datos reales del usuario. La actividad por sí sola no sustituye código SIN, unidad y origen válidos para facturar. Probar cancelación/reversión real solo con otra factura elegible y autorización fiscal separada; nunca con las facturas piloto históricas.

## Verificaciones locales ya realizadas

`npm run typecheck`, `npm run build`, lint focalizado y `git diff --check` pasaron. La suite local terminó con 297 pruebas aprobadas y cuatro opcionales omitidas. PostgreSQL sintético aprobó la migración de correo, RLS, concurrencia e idempotencia. La factura piloto 3 se verificó **solo por lectura**: `ANULADA`, validación original 908, recepción y XML firmado. Falta verificación visual autenticada de los botones y prueba real del proveedor de correo tras publicación.
