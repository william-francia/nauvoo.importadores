# Exporta fuentes revisadas; nunca ejecuta SQL ni contacta servicios.
[CmdletBinding()]
param([string]$Destino = '')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$utf8 = New-Object Text.UTF8Encoding($false)
if (-not $Destino) {
  $Destino = Join-Path ([Environment]::GetFolderPath('MyDocuments')) ('NUVOO-SIAT-KIT-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
}
$dest = [IO.Path]::GetFullPath($Destino).TrimEnd('\')
if ($dest -eq $repo -or $dest.StartsWith($repo + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'El destino debe estar fuera del repositorio.' }
if (Test-Path -LiteralPath $dest) { throw 'El destino ya existe: no se sobrescribe.' }
function Assert-NoLink([string]$path) {
  $cursor = $path
  while ($cursor) {
    if (Test-Path -LiteralPath $cursor) {
      if ((Get-Item -Force -LiteralPath $cursor).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'No se exporta mediante enlaces o junctions.' }
    }
    $parent = Split-Path -Parent $cursor
    if ($parent -eq $cursor) { break }
    $cursor = $parent
  }
}
Assert-NoLink $dest

# Lista literal: agregar archivos exige revisarlos; no se copian carpetas por comodines.
$permitidos = @(
  '.env.example'
  'agent-local/README.md'
  'agent-local/src/app.ts'
  'agent-local/src/config.ts'
  'agent-local/src/contingency-safety.ts'
  'agent-local/src/fiscal.ts'
  'agent-local/src/manual-cafc.ts'
  'agent-local/src/manual-cafc-form.ts'
  'agent-local/src/remote.ts'
  'agent-local/src/security.ts'
  'agent-local/src/server.ts'
  'agent-local/src/state-machine.ts'
  'agent-local/src/store.ts'
  'agent-local/src/types.ts'
  'agent-local/tsconfig.json'
  'docs/siat/SIAT-KIT-REUTILIZABLE.md'
  'eslint.config.js'
  'package.json'
  'package-lock.json'
  'scripts/generar-xsd-siat.mjs'
  'src/features/facturas/components/ConfiguracionSiatModal.tsx'
  'src/features/facturas/components/FiscalEvidencePanel.tsx'
  'src/features/facturas/components/PilotPreviewSiat.tsx'
  'src/features/facturas/components/RegistrarContingenciaModal.tsx'
  'src/features/facturas/components/SiatShared.tsx'
  'src/features/facturas/constants/siat.constants.ts'
  'src/features/facturas/schemas/siat.schemas.ts'
  'src/features/facturas/services/aviso-fiscal.service.ts'
  'src/features/facturas/services/cafc-transcripcion.ts'
  'src/features/facturas/services/documentos-fiscales.service.ts'
  'src/features/facturas/services/offline-idempotency.ts'
  'src/features/facturas/services/siat.gateway.contract.ts'
  'src/features/facturas/services/siat.gateway.service.ts'
  'src/features/facturas/services/siat.local-agent.service.ts'
  'src/features/facturas/services/siat.service.ts'
  'src/features/facturas/styles/siat.css'
  'src/features/facturas/types/siat.types.ts'
  'src/features/ventas/components/ClienteSelector.tsx'
  'src/features/ventas/components/ConfirmarVentaModal.tsx'
  'src/features/ventas/components/gestion/FacturaActionsMenu.tsx'
  'src/features/ventas/components/gestion/GestionVentasTable.tsx'
  'src/features/ventas/components/gestion/ResendEmailModal.tsx'
  'src/features/ventas/components/gestion/SinDetailsModal.tsx'
  'src/features/ventas/components/NuevoClienteModal.tsx'
  'src/features/ventas/components/PagoPanel.tsx'
  'src/features/ventas/components/ProductoSelector.tsx'
  'src/features/ventas/components/VentaItemsTable.tsx'
  'src/features/ventas/GestionVentasPage.tsx'
  'src/features/ventas/hooks/useGestionVentas.ts'
  'src/features/ventas/hooks/useVentaDraft.ts'
  'src/features/ventas/NuevaVentaPage.tsx'
  'src/features/ventas/services/ventas.api.ts'
  'src/features/ventas/styles/gestionVentas.css'
  'src/features/ventas/types/gestionVentas.types.ts'
  'src/features/ventas/types/ventas.types.ts'
  'src/features/ventas/ventas.css'
  'src/lib/supabase.ts'
  'src/pages/facturas/ContingenciasPage.tsx'
  'src/pages/facturas/EventosPage.tsx'
  'src/pages/facturas/FacturasPage.tsx'
  'src/pages/facturas/RegistrarVentaOfflinePage.tsx'
  'src/pages/facturas/VentasOfflinePage.tsx'
  'supabase/functions/_shared/siat/artifacts/SIAT_VIGENTE/FacturacionCodigos.wsdl'
  'supabase/functions/_shared/siat/artifacts/SIAT_VIGENTE/FacturacionCodigosInterface.wsdl'
  'supabase/functions/_shared/siat/artifacts/SIAT_VIGENTE/FacturacionSincronizacion.wsdl'
  'supabase/functions/_shared/siat/artifacts/SIAT_VIGENTE/FacturacionSincronizacionInterface.wsdl'
  'supabase/functions/_shared/siat/artifacts/SIAT_VIGENTE/facturaComputarizadaCompraVenta.xsd'
  'supabase/functions/_shared/siat/artifacts/SIAT_VIGENTE/facturaElectronicaCompraVenta.xsd'
  'supabase/functions/_shared/siat/artifacts/SIAT_VIGENTE/MANIFEST.json'
  'supabase/functions/_shared/siat/artifacts/SIAT_VIGENTE/ServicioFacturacionCompraVenta.wsdl'
  'supabase/functions/_shared/siat/artifacts/SIAT_VIGENTE/ServicioFacturacionCompraVentaInterface.wsdl'
  'supabase/functions/_shared/siat/artifacts/SIAT_VIGENTE/SignatureSchema.xsd'
  'supabase/functions/_shared/siat/brand-logo.ts'
  'supabase/functions/_shared/siat/cafc-document.ts'
  'supabase/functions/_shared/siat/cafc-link-control.ts'
  'supabase/functions/_shared/siat/contingency-controls.ts'
  'supabase/functions/_shared/siat/contingency-probe.ts'
  'supabase/functions/_shared/siat/cuf.ts'
  'supabase/functions/_shared/siat/document-access.ts'
  'supabase/functions/_shared/siat/encoding.ts'
  'supabase/functions/_shared/siat/engine.ts'
  'supabase/functions/_shared/siat/fiscal-document.ts'
  'supabase/functions/_shared/siat/fiscal-operation.ts'
  'supabase/functions/_shared/siat/fiscal-pdf.ts'
  'supabase/functions/_shared/siat/fiscal-soap-evidence.ts'
  'supabase/functions/_shared/siat/immutable-artifact.ts'
  'supabase/functions/_shared/siat/invoice-xml.ts'
  'supabase/functions/_shared/siat/ley1733.adapter.ts'
  'supabase/functions/_shared/siat/money.ts'
  'supabase/functions/_shared/siat/notification-email.ts'
  'supabase/functions/_shared/siat/notification-evidence.ts'
  'supabase/functions/_shared/siat/official-vigente.adapter.ts'
  'supabase/functions/_shared/siat/pilot-approval.ts'
  'supabase/functions/_shared/siat/pilot-preview.ts'
  'supabase/functions/_shared/siat/qr.ts'
  'supabase/functions/_shared/siat/repository.ts'
  'supabase/functions/_shared/siat/runtime.ts'
  'supabase/functions/_shared/siat/signature-credentials.ts'
  'supabase/functions/_shared/siat/signature-test.ts'
  'supabase/functions/_shared/siat/soap.ts'
  'supabase/functions/_shared/siat/tar.ts'
  'supabase/functions/_shared/siat/types.ts'
  'supabase/functions/_shared/siat/xmldsig.ts'
  'supabase/functions/_shared/siat/xsd.ts'
  'supabase/functions/_shared/siat/xsd-embebidos.ts'
  'supabase/functions/import_map.json'
  'supabase/functions/siat-gateway/index.ts'
  'supabase/functions/siat-local-ingest/index.ts'
  'supabase/functions/siat-maintenance/index.ts'
  'supabase/functions/siat-worker/index.ts'
  'supabase/migraciones/20260908120000_initial_schema.sql'
  'supabase/migraciones/20260908130000_clientes_integracion.sql'
  'supabase/migrations/20260908130000_registrar_venta_rpc.sql'
  'supabase/migrations/20260916203000_siat_fase_1_base.sql'
  'supabase/migrations/20260917200000_siat_fase_2_motor_online.sql'
  'supabase/migrations/20260917300000_siat_fase_3_contingencia.sql'
  'supabase/migrations/20260918100000_cuentas_roles_permisos.sql'
  'supabase/migrations/20260918173000_productos_persistencia.sql'
  'supabase/migrations/20260918180000_siat_catalogo_clave_natural.sql'
  'supabase/migrations/20260918181000_siat_deduplicar_unidades_oficiales.sql'
  'supabase/migrations/20260918182000_siat_numeracion_fiscal_segura.sql'
  'supabase/migrations/20260922210000_inventario_real_rpc.sql'
  'supabase/migrations/20260923120000_ventas_stock_cero.sql'
  'supabase/migrations/20261023010000_siat_piloto_aislado.sql'
  'supabase/migrations/20261023013000_siat_estado_sincronizacion_online.sql'
  'supabase/migrations/20261023014000_siat_piloto_descripcion_snapshot.sql'
  'supabase/migrations/20261023020000_siat_piloto_evidencia_nit_certificado.sql'
  'supabase/migrations/20261023023000_siat_piloto_ci_cliente.sql'
  'supabase/migrations/20261023030000_siat_piloto_declaracion_verbal.sql'
  'supabase/migrations/20261030020000_siat_segundo_piloto_controlado.sql'
  'supabase/migrations/20261030030000_siat_proteger_xml_fiscal.sql'
  'supabase/migrations/20261103010000_siat_paso9_operaciones_piloto.sql'
  'supabase/migrations/20261103020000_siat_aislar_tareas_paso9.sql'
  'supabase/migrations/20261103030000_siat_9a_evidencias.sql'
  'supabase/migrations/20261103040000_siat_9a_correo.sql'
  'supabase/migrations/20261103050000_siat_9a_soap_evidencia.sql'
  'supabase/migrations/20261103055000_siat_9a_tercera_factura_piloto.sql'
  'supabase/migrations/20261103060000_siat_9b_importacion_idempotente.sql'
  'supabase/migrations/20261103070000_siat_9b_estado_recuperacion.sql'
  'supabase/migrations/20261103080000_siat_9b_cafc_venta_existente.sql'
  'supabase/migrations/20261113010000_siat_numeracion_compartida.sql'
  'tests/agent/availability.test.ts'
  'tests/agent/manual-cafc.test.ts'
  'tests/agent/manual-cafc-agent.test.ts'
  'tests/agent/manual-cafc-form.test.ts'
  'tests/agent/number-reservation.test.ts'
  'tests/agent/recovery.test.ts'
  'tests/agent/single-instance.test.ts'
  'tests/agent/state-machine.test.ts'
  'tests/agent/store.test.ts'
  'tests/fixtures/siat-contingency-simulator.ts'
  'tests/siat/cafc-form.test.ts'
  'tests/siat/cafc-integracion-local.test.ts'
  'tests/siat/contingency-integral.test.ts'
  'tests/siat/contingency-probe.test.ts'
  'tests/siat/contingency-simulator.test.ts'
  'tests/siat/contracts.test.ts'
  'tests/siat/core.test.ts'
  'tests/siat/documentos-fiscales.test.ts'
  'tests/siat/documentos-gateway.test.ts'
  'tests/siat/edge-nonce-postgres-local.test.ts'
  'tests/siat/edge-nonce-probe.test.ts'
  'tests/siat/emission.test.ts'
  'tests/siat/fiscal-pdf.test.ts'
  'tests/siat/numeracion-concurrency-local.mjs'
  'tests/siat/numeracion-setup-local.sql'
  'tests/siat/offline-idempotency.test.ts'
  'tests/siat/offline-real-concurrency-local.ps1'
  'tests/siat/offline-real-import-local.sql'
  'tests/siat/phase3-contracts.test.ts'
  'tests/siat/phase9a-claim-local.sql'
  'tests/siat/phase9a-evidence.test.ts'
  'tests/siat/phase9a-evidencias-local.sql'
  'tests/siat/phase9a-gateway-dispatch.test.ts'
  'tests/siat/phase9a-soap-evidence.test.ts'
  'tests/siat/phase9a-soap-sql-local.sql'
  'tests/siat/phase9b-cafc-concurrency-local.ps1'
  'tests/siat/phase9b-cafc-link-local.sql'
  'tests/siat/phase9b-cafc-schema-local.sql'
  'tests/siat/phase9b-controls.test.ts'
  'tests/siat/phase9b-import-concurrency-local.ps1'
  'tests/siat/phase9b-import-local.sql'
  'tests/siat/phase9b-recovery.test.ts'
  'tests/siat/phase9b-recovery-local.sql'
  'tests/siat/phase9-concurrency-local.ps1'
  'tests/siat/phase9-queue-local.sql'
  'tests/siat/phase9-safety.test.ts'
  'tests/siat/phase9-sql-local.sql'
  'tests/siat/pilot-ci.test.ts'
  'tests/siat/pilot-db-smoke.sql'
  'tests/siat/pilot-isolation.test.ts'
  'tests/siat/pilot-nit-approval.test.ts'
  'tests/siat/pilot-preview.test.ts'
  'tests/siat/reception-recovery.test.ts'
  'tests/siat/second-pilot-local.sql'
  'tests/siat/signature-runtime.deno.ts'
  'tests/siat/soap.test.ts'
  'tests/siat/tar.test.ts'
  'tests/siat/third-pilot-concurrency.mjs'
  'tests/siat/third-pilot-local.sql'
  'tests/siat/worker-reconciliation.test.ts'
  'tests/siat/xsd-embebidos.test.ts'
  'tsconfig.app.json'
  'tsconfig.json'
  'tsconfig.node.json'
  'vite.config.ts'
)
if (@($permitidos | Sort-Object -Unique).Count -ne $permitidos.Count) { throw 'Lista permitida duplicada.' }

# Datos piloto tomados del código, no de Secrets ni de registros comerciales.
# Solo se transforman las copias. Si cambian estos contratos, revisar antes de exportar.
$approval = [IO.File]::ReadAllText((Join-Path $repo 'supabase/functions/_shared/siat/pilot-approval.ts'))
$preview = [IO.File]::ReadAllText((Join-Path $repo 'supabase/functions/_shared/siat/pilot-preview.ts'))
$rules = @(
  @($approval, 'client\.numero_documento\s*!==\s*"([^"]+)"', 'DOCUMENTO_PILOTO_PENDIENTE'),
  @($approval, 'client\.nombre_razon_social\s*!==\s*"([^"]+)"', 'CLIENTE_PILOTO_PENDIENTE'),
  @($approval, 'client\.codigo_cliente\s*!==\s*"([^"]+)"', 'CLIENTE_CODIGO_PENDIENTE'),
  @($preview, 'String\(config\.nit\s*\?\?\s*""\)\s*!==\s*"(\d+)"', 'NIT_EMISOR_PENDIENTE')
)
$redactions = @{}
foreach ($rule in $rules) {
  $match = [regex]::Match($rule[0], $rule[1])
  if (-not $match.Success) { throw 'No se reconoce el contrato de anonimización del piloto.' }
  $redactions[$match.Groups[1].Value] = $rule[2]
}
$secretPattern = '(?is)-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----\s*[A-Za-z0-9+/=\r\n]{64,}-----END|sb_secret_[A-Za-z0-9_-]{15,}|sbp_[a-f0-9]{20,}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}|postgres(?:ql)?://[^@\s]+@'
$emailPattern = '(?i)[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
$uuidPattern = '(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b'
function Get-BytesHash([byte[]]$bytes) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() }
  finally { $sha.Dispose() }
}
$uuidEvaluator = [Text.RegularExpressions.MatchEvaluator]{
  param($match)
  $hex = Get-BytesHash ($utf8.GetBytes('siat-kit-ejemplo:' + $match.Value.ToLowerInvariant()))
  return ([guid]::ParseExact($hex.Substring(0,32), 'N')).ToString('D')
}
$prepared = @()
foreach ($relative in $permitidos) {
  if ($relative -match '(^|/)(\.git|\.siat-agent|output|node_modules|backups?)(/|$)' -or
      ($relative -match '(^|/)\.env' -and $relative -ne '.env.example') -or
      $relative -match '\.(pem|p12|pfx|key|dump|backup|sqlite|db|log|zip)$') { throw "Ruta prohibida: $relative" }
  $source = [IO.Path]::GetFullPath((Join-Path $repo $relative))
  if (-not $source.StartsWith($repo + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Fuente fuera del repositorio.' }
  Assert-NoLink $source
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Falta fuente permitida: $relative" }
  $original = [IO.File]::ReadAllText($source)
  if ([regex]::IsMatch($original, $secretPattern)) { throw "Posible credencial incrustada; no se exporta: $relative" }
  if ($relative -eq '.env.example' -and $original -match '(?m)^[ \t]*\w*(?:SECRET|KEY|TOKEN|PEM)\w*[ \t]*=[ \t]*\S+') { throw 'La plantilla contiene un valor de credencial: revisar sin publicarlo.' }
  $copy = $original
  foreach ($value in $redactions.Keys) { $copy = $copy.Replace($value, $redactions[$value]) }
  $copy = [regex]::Replace($copy, $emailPattern, 'contacto@example.invalid')
  $copy = [regex]::Replace($copy, $uuidPattern, $uuidEvaluator)
  foreach ($value in $redactions.Keys) {
    if ($copy.Contains($value)) { throw "Anonimización incompleta: $relative" }
  }
  $prepared += [pscustomobject]@{
    ruta = $relative; texto = $copy
    sha256_original = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    sha256 = Get-BytesHash ($utf8.GetBytes($copy))
    adaptado = ($copy -cne $original)
  }
}

# Todas las fuentes se validan antes de crear la carpeta. No borrar ni sobrescribir.
$null = New-Item -ItemType Directory -Path $dest
$manifest = @()
foreach ($item in $prepared) {
  $target = Join-Path $dest $item.ruta
  $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $target))
  $stream = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $bytes = $utf8.GetBytes($item.texto); $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
  if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256) { throw "Integridad fallida: $($item.ruta)" }
  $manifest += $item | Select-Object ruta,sha256,sha256_original,adaptado
}
$install = @'
# Instalacion del kit de fuentes SIAT
Lea docs/siat/SIAT-KIT-REUTILIZABLE.md antes de instalar.
No es un instalador autonomo ni una autorizacion fiscal.
Las copias contienen marcadores en lugar de identidades del piloto y UUID de ejemplo.
Adapte empresa, modelo comercial, permisos, rutas piloto, marca y configuracion.
No ejecutar migraciones anonimizadas en una base existente sin revisar sus dependencias.
No incluye credenciales, datos del agente, documentos de clientes ni respaldos.
El frontend requiere integrarse al shell y componentes comerciales del sistema destino.
No se ha emitido, reservado, desplegado ni conectado a ningun servicio durante la exportacion.

Integridad (PowerShell, desde esta carpeta):
$m = Get-Content -Raw ./MANIFEST-SHA256.json | ConvertFrom-Json
foreach ($f in $m.archivos) {
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $f.ruta).Hash.ToLowerInvariant() -ne $f.sha256) {
    throw "Integridad incorrecta: $($f.ruta)"
  }
}
'@
[IO.File]::WriteAllText((Join-Path $dest 'INSTALACION.md'), $install, $utf8)
$manifest += [pscustomobject]@{ ruta='INSTALACION.md'; sha256=(Get-FileHash -LiteralPath (Join-Path $dest 'INSTALACION.md') -Algorithm SHA256).Hash.ToLowerInvariant(); sha256_original=$null; adaptado=$false }
$report = [ordered]@{ formato=1; creado_utc=[DateTime]::UtcNow.ToString('o'); tipo='FUENTES_PARA_ADAPTAR_NO_DESPLEGAR_DIRECTAMENTE'; archivos=$manifest }
[IO.File]::WriteAllText((Join-Path $dest 'MANIFEST-SHA256.json'), ($report | ConvertTo-Json -Depth 5), $utf8)
Write-Output ("Kit creado y hashes verificados: " + $dest)
Write-Output ("Archivos de fuentes: " + $prepared.Count + "; anonimizados: " + @($prepared | Where-Object adaptado).Count)
