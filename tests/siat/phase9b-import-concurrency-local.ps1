# Solo PostgreSQL sintético en localhost; no llama al SIN ni crea eventos.
$ErrorActionPreference = 'Stop'
$bin = 'C:\Program Files\PostgreSQL\18\bin'
$dbName = 'nuvoo_9b_test_' + [guid]::NewGuid().ToString('N')
$agentId = [guid]::NewGuid().ToString()
$invoiceId = [guid]::NewGuid().ToString()
$key = 'concurrencia-' + [guid]::NewGuid().ToString('N')
& "$bin\createdb.exe" -h 127.0.0.1 -p 55449 -U postgres $dbName
if ($LASTEXITCODE -ne 0) { throw 'No se creó la base sintética.' }
try {
  $setup = @"
CREATE TABLE public.facturas_siat(id uuid PRIMARY KEY,ambiente text,origen_fiscal text,estado_fiscal text);
CREATE TABLE public.siat_agentes_locales(id uuid PRIMARY KEY,codigo text,estado text);
CREATE TABLE public.siat_importaciones_offline(idempotency_key text PRIMARY KEY);
CREATE FUNCTION public.siat_importar_factura_offline(p_agente text,p_payload jsonb) RETURNS uuid LANGUAGE plpgsql AS `$`$
DECLARE f uuid:=(p_payload->>'facturaId')::uuid;
BEGIN
  PERFORM pg_sleep(0.5);
  INSERT INTO public.facturas_siat(id,ambiente,origen_fiscal,estado_fiscal) VALUES(f,'PRUEBAS','PILOTO','OFFLINE');
  INSERT INTO public.siat_importaciones_offline VALUES(p_payload->>'idempotencyKey');
  RETURN f;
END; `$`$;
INSERT INTO public.siat_agentes_locales VALUES('$agentId','AGENTE_TEST','ACTIVO');
"@
  & "$bin\psql.exe" -h 127.0.0.1 -p 55449 -U postgres -d $dbName -v ON_ERROR_STOP=1 -c $setup | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'No se preparó el esquema sintético.' }
  & "$bin\psql.exe" -h 127.0.0.1 -p 55449 -U postgres -d $dbName -v ON_ERROR_STOP=1 -f 'supabase/migrations/20261103060000_siat_9b_importacion_idempotente.sql' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'No se aplicó la migración sintética.' }
  $hashA = 'A' * 64; $hashB = 'B' * 64
  $query = "SELECT public.siat_importar_factura_offline_v2('AGENTE_TEST',jsonb_build_object('idempotencyKey','$key','facturaId','$invoiceId','xmlHash','$hashA','adjuntosHash',jsonb_build_object('xml','$hashA','pdf','$hashB')));"
  $jobs = 1..2 | ForEach-Object { Start-Job -ArgumentList "$bin\psql.exe",$dbName,$query -ScriptBlock { param($exe,$db,$sql) & $exe -h 127.0.0.1 -p 55449 -U postgres -d $db -v ON_ERROR_STOP=1 -Atc $sql; if ($LASTEXITCODE -ne 0) { throw 'Falló importación simultánea.' } } }
  $jobs | Wait-Job | Out-Null
  $results = @($jobs | Receive-Job)
  if (($jobs | Where-Object { $_.State -ne 'Completed' }).Count -gt 0 -or $results.Count -ne 2 -or @($results | Where-Object { $_ -ne $invoiceId }).Count -gt 0) { throw 'Resultado concurrente no idempotente.' }
  $count = & "$bin\psql.exe" -h 127.0.0.1 -p 55449 -U postgres -d $dbName -v ON_ERROR_STOP=1 -Atc 'SELECT count(*) FROM public.siat_9b_importacion_huellas'
  if ($LASTEXITCODE -ne 0 -or $count -ne '1') { throw 'Se duplicó la importación.' }
  Write-Output 'Dos importaciones simultáneas; una factura sintética y una huella.'
} finally {
  if ($dbName -notmatch '^nuvoo_9b_test_[0-9a-f]{32}$') { throw 'Nombre de base sintética inesperado.' }
  & "$bin\dropdb.exe" -h 127.0.0.1 -p 55449 -U postgres $dbName
}
