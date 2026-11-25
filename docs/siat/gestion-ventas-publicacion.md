# Gestión de ventas y documentos SIAT: publicación pendiente

Rama: `feature/siat-gestion-ventas`. Esta guía prepara una intervención posterior; no constituye autorización para publicar ni para ejecutar operaciones fiscales.

## Dependencias y configuración

- Proyecto previsto: `vzpufrxjmdjjkikvpeev`, ambiente `PRUEBAS` (PILOTO). Confirmar el proyecto y el estado de las funciones antes de intervenir.
- La consulta de facturas desde Ventas usa las tablas y políticas existentes de `ventas`, `facturas_siat`, `clientes`, `usuarios` y `siat_auditoria`. No requiere una venta nueva ni una migración para mostrarlas.
- Anulación y reversión usan `cancel`, `reverse`, el catálogo `MOTIVOS_ANULACION`, las capacidades 9A, el worker y la RPC 9A publicados. Sus interruptores y requisitos fiscales siguen vigentes. `REVERTIDA` es el estado persistido tras una reversión oficial; la tabla lo muestra como «VALIDADA (revertida)» sin perder la evidencia de reversión.
- El envío de factura por correo requiere proveedor configurado: `RESEND_API_KEY`, `SIAT_EMAIL_FROM` y `SIAT_NOTIFICACION_HMAC_KEY` (mínimo 32 caracteres). Revisar solo la presencia de los nombres; no imprimir ni reemplazar valores. Confirmar remitente y dominio autorizados por el proveedor. Sin proveedor, el botón informa que no está disponible.
- PDF/XML/consulta oficial se habilitan para documentos PILOTO con validación original 908, transacción verdadera, recepción, CUF, XML firmado y hash íntegro. Los PDF de `ANULADA` llevan marca de agua. Producción permanece sin URL de consulta verificada en el código.

## Orden de publicación, tras autorización específica

1. Revisar cambios pendientes y las migraciones aplicadas en el proyecto indicado. **No ejecutar `supabase db push`**: aplicaría otras migraciones pendientes. La única migración nueva de esta rama es `supabase/migrations/20261124010000_siat_entrega_correo_factura.sql`, aditiva; crea registro privado de intentos de correo y dos RPC restringidas a `service_role`. Desde la raíz del repositorio, copiar su texto para revisarlo y pegarlo una sola vez en el SQL Editor del proyecto correcto:

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
4. El frontend usa Vite local. Tras actualizar la rama, ejecutar `npm run dev` y abrir `http://localhost:5173` → Ventas → Gestión de ventas. Pulsar **Actualizar** y comprobar facturas piloto 1, 2 y 3, estados, ambientes y acciones de lectura. Para PDF de la factura 3 comprobar la marca «ANULADO» en carta y ambos rollos. Probar cancelación/reversión real solo con otra factura elegible y autorización fiscal separada; nunca con las facturas piloto históricas.

## Verificaciones locales ya realizadas

`npm run typecheck`, `npm run build`, lint focalizado y `git diff --check` pasaron. La suite local terminó con 297 pruebas aprobadas y cuatro opcionales omitidas. PostgreSQL sintético aprobó la migración de correo, RLS, concurrencia e idempotencia. La factura piloto 3 se verificó **solo por lectura**: `ANULADA`, validación original 908, recepción y XML firmado. Falta verificación visual autenticada de los botones y prueba real del proveedor de correo tras publicación.
