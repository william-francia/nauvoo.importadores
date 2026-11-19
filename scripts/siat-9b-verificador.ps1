param([switch]$SelfTest)
$ErrorActionPreference = 'Stop'

function Read-CliJson([int]$ExitCode, [string]$Stdout, [string]$Stderr) {
  if ($ExitCode -ne 0 -or $Stderr -match '(?im)^\s*(error|fatal)\s*:') { throw 'CLI_FALLO_REAL' }
  try { return ($Stdout | ConvertFrom-Json -ErrorAction Stop) } catch { throw 'CLI_JSON_INVALIDO' }
}
function Sanitize-Diagnostic([string]$Message, [string]$Secret) {
  if (-not $Message) { return '' }
  if ($Secret) { $Message = $Message.Replace($Secret, '[REDACTADO]') }
  $Message = $Message -replace '(?i)Bearer\s+[^\s"'',}]+', 'Bearer [REDACTADO]'
  $Message = $Message -replace 'eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[REDACTADO]'
  $Message = $Message -replace '(?i)(apikey|token|secret|password)(\s*[=:]\s*|"\s*:\s*")[^\s"'',}]+', '$1$2[REDACTADO]'
  return $Message.Substring(0, [Math]::Min(1000, $Message.Length))
}
function Select-EdgeKey($Candidates, [string]$ExpectedDigest) {
  if ($ExpectedDigest -notmatch '^[a-f0-9]{64}$') { throw 'HUELLA_EDGE_INVALIDA' }
  $matched = @()
  foreach ($candidate in $Candidates) {
    $value = [string]$candidate.api_key
    if (-not $value -or $value.Contains('*') -or ($candidate.name -ne 'service_role' -and -not $value.StartsWith('sb_secret_'))) { continue }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $digest = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($value))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
    if ($digest -eq $ExpectedDigest) { $matched += $candidate }
  }
  if ($matched.Count -ne 1) { throw 'CREDENCIAL_EDGE_NO_LOCALIZADA' }
  return $matched[0]
}

if ($SelfTest) {
  $ok = Read-CliJson 0 '[{"name":"service_role","api_key":"sintetica"}]' 'A new version of Supabase CLI is available'
  if (@($ok).Count -ne 1 -or @($ok)[0].name -ne 'service_role') { throw 'SELFTEST_JSON_FALLIDO' }
  $multiple = @(Read-CliJson 0 '[{"name":"anon","api_key":"sintetica1"},{"name":"service_role","api_key":"sintetica2"}]' '')
  if ($multiple.Count -ne 2 -or @($multiple | Where-Object { $_.name -eq 'service_role' }).Count -ne 1) { throw 'SELFTEST_LISTA_FALLIDO' }
  foreach ($test in @(@(1, '[]', 'error: fallo'), @(0, '[]', 'error: fallo'), @(0, 'no-json', 'advertencia'))) {
    $rejected = $false; try { $null = Read-CliJson $test[0] $test[1] $test[2] } catch { $rejected = $true }
    if (-not $rejected) { throw 'SELFTEST_DEBIO_RECHAZAR' }
  }
  if ((Sanitize-Diagnostic 'Bearer secreto-falso token=secreto-falso' 'secreto-falso') -match 'secreto-falso') { throw 'SELFTEST_REDACTADO_FALLIDO' }
  $shaTest = [Security.Cryptography.SHA256]::Create()
  try { $digestTest = [BitConverter]::ToString($shaTest.ComputeHash([Text.Encoding]::UTF8.GetBytes('sb_secret_sintetica'))).Replace('-', '').ToLowerInvariant() } finally { $shaTest.Dispose() }
  $testKeys = @([pscustomobject]@{name='service_role';api_key='jwt-sintetico'},[pscustomobject]@{name='default';api_key='sb_secret_sintetica'})
  if ((Select-EdgeKey $testKeys $digestTest).name -ne 'default') { throw 'SELFTEST_SELECCION_FALLIDO' }
  Write-Output 'Verificador: advertencia, éxito, fallo y JSON inválido comprobados.'
  exit 0
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$npx = Join-Path (Split-Path $node) 'node_modules\npm\bin\npx-cli.js'
if (-not (Test-Path -LiteralPath $npx -PathType Leaf)) { throw 'NPX_NO_DISPONIBLE' }
$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = $node
$start.Arguments = '"' + $npx + '" supabase projects api-keys --project-ref vzpufrxjmdjjkikvpeev --reveal --output json'
$start.UseShellExecute = $false; $start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
$process = New-Object System.Diagnostics.Process
$process.StartInfo = $start
if (-not $process.Start()) { throw 'CLI_NO_INICIADA' }
$outTask = $process.StandardOutput.ReadToEndAsync(); $errTask = $process.StandardError.ReadToEndAsync()
if (-not $process.WaitForExit(45000)) { $process.Kill(); throw 'CLI_TIMEOUT' }
$keys = Read-CliJson $process.ExitCode $outTask.Result $errTask.Result
$start.Arguments = '"' + $npx + '" supabase secrets list --project-ref vzpufrxjmdjjkikvpeev --output json'
$secretProcess = New-Object System.Diagnostics.Process; $secretProcess.StartInfo = $start
if (-not $secretProcess.Start()) { throw 'CLI_NO_INICIADA' }
$secretOut = $secretProcess.StandardOutput.ReadToEndAsync(); $secretErr = $secretProcess.StandardError.ReadToEndAsync()
if (-not $secretProcess.WaitForExit(45000)) { $secretProcess.Kill(); throw 'CLI_TIMEOUT' }
$secretMeta = @(Read-CliJson $secretProcess.ExitCode $secretOut.Result $secretErr.Result)
$digestEntry = @($secretMeta | Where-Object { $_.name -eq 'SUPABASE_SERVICE_ROLE_KEY' })
if ($digestEntry.Count -ne 1) { throw 'HUELLA_EDGE_NO_DISPONIBLE' }
$entry = @(Select-EdgeKey $keys ([string]$digestEntry[0].value))
try {
  $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'https://vzpufrxjmdjjkikvpeev.supabase.co/functions/v1/siat-worker' -Headers @{ Authorization = ('Bearer ' + $entry[0].api_key); apikey = $entry[0].api_key } -ContentType 'application/json' -Body '{"action":"probe-9b-readonly"}' -TimeoutSec 40
  Write-Output ('HTTP_STATUS=' + [int]$response.StatusCode + '; CLI_EXIT=' + $process.ExitCode)
  Write-Output ('HTTP_BODY=' + (Sanitize-Diagnostic $response.Content $entry[0].api_key))
  $result = $response.Content | ConvertFrom-Json -ErrorAction Stop
  if ($result.edge -ne $true -or $result.rpc -ne 'siat_9b_estado_recuperacion' -or $result.rechazoEsperado -ne $true -or $result.escritura -ne $false) { throw 'RESPUESTA_NO_CONCLUYENTE' }
  Write-Output 'Edge -> RPC -> PostgreSQL: rechazo esperado confirmado; sin escritura.'
} catch {
  $httpStatus = 'sin respuesta'; $httpBody = ''; $exception = $_.Exception
  if ($exception.Response) {
    $httpStatus = [string][int]$exception.Response.StatusCode
    try { $reader = New-Object System.IO.StreamReader($exception.Response.GetResponseStream()); $httpBody = $reader.ReadToEnd(); $reader.Dispose() } catch { $httpBody = '[cuerpo no disponible]' }
  }
  Write-Output ('HTTP_STATUS=' + $httpStatus + '; CLI_EXIT=' + $process.ExitCode + '; POWERSHELL_EXCEPTION=' + (Sanitize-Diagnostic ($exception.GetType().FullName + ': ' + $exception.Message) $entry[0].api_key))
  Write-Output ('HTTP_BODY=' + (Sanitize-Diagnostic $httpBody $entry[0].api_key))
  Write-Output 'CODIGO_SALIDA=1; PRUEBA_EDGE_NO_CONCLUYENTE'
  exit 1
} finally { $keys = $null; $entry = $null }
