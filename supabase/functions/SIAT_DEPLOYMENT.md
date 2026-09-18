# Despliegue SIAT: motor online, contingencia y agente local

Esta entrega permanece bloqueada a `PRUEBAS`. Compilar el software no habilita producción ni sustituye la autorización del SIN.

## Orden de instalación

1. Aplicar, en orden, las migraciones `20260916203000`, `20260917200000` y `20260917300000`.
2. Registrar cada establecimiento en `siat_agentes_locales`; un agente activo por sucursal/punto de venta.
3. Desplegar `siat-gateway`, `siat-worker`, `siat-maintenance` y `siat-local-ingest`.
4. Configurar los secretos de Edge Functions: `SIAT_TOKEN_DELEGADO`, certificado/clave si la modalidad es electrónica, y secretos diferentes para worker, scheduler y agente.
5. Instalar un agente Node por sucursal/punto de venta compartido y ejecutar `npm run agent:start` con las variables de `.env.example`.
6. Desde **Facturas > Contingencias**, aprovisionar el agente con conexión. Descarga catálogos, clientes, stock, CUIS/CUFD, reglas, CAFC y un bloque exclusivo de numeración.
7. Programar `siat-maintenance` cada hora y despertar `siat-worker` solo con sus encabezados secretos.

El agente escucha por defecto en `127.0.0.1:4737`, valida al usuario contra Supabase durante el enlace y devuelve una cookie `HttpOnly`, `SameSite=Strict`; no conserva el JWT. Base, diario, documentos y evidencias se cifran con AES-256-GCM.

Tras tres fallos consecutivos y un tipo oficial previamente configurado, la máquina entra en contingencia. La recuperación importa evento y facturas, crea TAR/GZIP de hasta 500 XML y consulta validación 901/904/908. CAFC es un flujo separado con rango vigente, número no reutilizable y evidencia original.

## Backup y restauración

- Crear respaldo con `POST /v1/backup` hacia otro volumen cifrado.
- Conservar `SIAT_AGENT_STORAGE_KEY` en un gestor de secretos separado.
- Para restaurar: detener, copiar el backup como `agent.sqlite.enc` en un directorio aislado, iniciar con la misma clave y comprobar `/v1/status` y `/v1/invoices`.
- Ejecutar recuperación. La idempotencia remota y el diario local evitan repetir venta, factura e inventario.
- Registrar el resultado mediante `backup-evidence` en `siat-local-ingest`.

Sin credenciales de piloto, certificado vigente y autorización del SIN, las pruebas oficiales son `BLOQUEADO_POR_CREDENCIALES_O_AUTORIZACION_SIN`. No habilitar `PRODUCCION` ni `SIAT_LEY_1733_PILOTO` automáticamente.
