param(
  [Parameter(Mandatory=$true)][ValidateSet('send','replay','cleanup')][string]$Mode,
  [string]$ProbeId = '',
  [string]$Timestamp = ''
)
$ErrorActionPreference = 'Stop'
$taskAgentDir = Join-Path $env:LOCALAPPDATA 'NUVOO\agente-siat-piloto'
$taskStart = Get-Content -Raw -LiteralPath (Join-Path $taskAgentDir 'iniciar-agente.ps1')
$taskCode = [regex]::Match($taskStart, "(?m)^\s*\`$env:SIAT_AGENT_CODE\s*=\s*'([A-Za-z0-9_-]{1,120})'\s*$")
$taskCredential = [regex]::Match($taskStart, "(?m)^\s*\`$env:SIAT_AGENT_SHARED_SECRET\s*=\s*\[NuvooAgentCredential\]::Read\('([^']+)'\)\s*$")
if (-not $taskCode.Success -or -not $taskCredential.Success) { throw 'CONFIGURACION_AGENTE_NO_RECONOCIDA' }
$oldCode = $env:SIAT_AGENT_CODE
$oldSecret = $env:SIAT_AGENT_SHARED_SECRET
try {
  $env:SIAT_AGENT_CODE = $taskCode.Groups[1].Value
  if ($Mode -in @('send','replay')) {
    . (Join-Path $taskAgentDir 'credential.ps1')
    $env:SIAT_AGENT_SHARED_SECRET = [NuvooAgentCredential]::Read($taskCredential.Groups[1].Value)
    if (-not $env:SIAT_AGENT_SHARED_SECRET -or $env:SIAT_AGENT_SHARED_SECRET.Length -lt 32) { throw 'CREDENCIAL_AGENTE_NO_DISPONIBLE' }
  }
  $driver = Join-Path $PSScriptRoot 'siat-9b-probar-edge.mjs'
  if ($Mode -eq 'send') { & node $driver send } elseif ($Mode -eq 'replay') { & node $driver replay $ProbeId $Timestamp } else { & node $driver cleanup $ProbeId }
  if ($LASTEXITCODE -ne 0) { throw 'SONDA_NO_COMPLETADA' }
} finally {
  if ($null -eq $oldCode) { Remove-Item Env:SIAT_AGENT_CODE -ErrorAction SilentlyContinue } else { $env:SIAT_AGENT_CODE = $oldCode }
  if ($null -eq $oldSecret) { Remove-Item Env:SIAT_AGENT_SHARED_SECRET -ErrorAction SilentlyContinue } else { $env:SIAT_AGENT_SHARED_SECRET = $oldSecret }
}
