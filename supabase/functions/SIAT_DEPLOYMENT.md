# Despliegue SIAT: motor online, contingencia y agente local

## Paso 2: configuración segura de piloto

Antes de desplegar, cargar las credenciales reales solamente como secretos de Supabase. No almacenar token, certificado, clave privada ni secretos compartidos en la base de datos, archivos `.env` versionados o variables `VITE_`. Los campos persistidos en `siat_configuracion` son no secretos: NIT, código de sistema, ambiente, modalidad, documento sector, sucursal y punto de venta.

Los endpoints de piloto vigentes no usan el sufijo `?wsdl`. Sustituir los marcadores sin incluir comillas ni valores reales en documentación:

```powershell
supabase secrets set SIAT_TOKEN_DELEGADO=<TOKEN_DELEGADO_PILOTO>
supabase secrets set SIAT_PRIVATE_KEY_PEM=<CLAVE_PRIVADA_PEM>
supabase secrets set SIAT_CERTIFICATE_PEM=<CERTIFICADO_PEM>
supabase secrets set SIAT_CODIGOS_URL=https://pilotosiatservicios.impuestos.gob.bo/v2/FacturacionCodigos
supabase secrets set SIAT_SINCRONIZACION_URL=https://pilotosiatservicios.impuestos.gob.bo/v2/FacturacionSincronizacion
supabase secrets set SIAT_OPERACIONES_URL=https://pilotosiatservicios.impuestos.gob.bo/v2/FacturacionOperaciones
supabase secrets set SIAT_COMPRA_VENTA_URL=https://pilotosiatservicios.impuestos.gob.bo/v2/ServicioFacturacionCompraVenta
supabase secrets set SIAT_TIMEOUT_MS=20000
supabase secrets set SIAT_ALLOWED_ORIGINS=<ORIGENES_PERMITIDOS_SEPARADOS_POR_COMA>
supabase secrets set SIAT_WORKER_SECRET=<SECRETO_WORKER_MINIMO_32_CARACTERES>
supabase secrets set SIAT_SCHEDULER_SECRET=<SECRETO_SCHEDULER_MINIMO_32_CARACTERES>
supabase secrets set SIAT_AGENT_SHARED_SECRET=<SECRETO_AGENTE_MINIMO_32_CARACTERES>
```

Estos comandos son únicamente instrucciones: no se ejecutaron como parte de este paso. La salud del gateway informa solo indicadores booleanos de configuración y nunca confirma conectividad con el SIN. Solicitar CUIS/CUFD, sincronizar, verificar conectividad y habilitar SIAT siguen fuera de alcance.

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
