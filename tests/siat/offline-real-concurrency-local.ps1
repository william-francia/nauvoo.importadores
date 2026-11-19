$ErrorActionPreference = 'Stop'
$bin = 'C:\Program Files\PostgreSQL\18\bin'
$template = 'nuvoo_9b_chain_4f3ffe5a863a48c4bafd0d3652f3039d'
$database = 'nuvoo_9b_concurrent_' + [guid]::NewGuid().ToString('N')
$common = @('-h','127.0.0.1','-p','55450','-U','postgres','-v','ON_ERROR_STOP=1')
$directory = & "$bin\psql.exe" @common -d $template -Atc 'SHOW data_directory'
if ($LASTEXITCODE -ne 0 -or $directory.Replace('\','/') -notmatch '/temp/nuvoo9b_integral_[0-9a-f]{32}$') { throw 'CLUSTER_SINTETICO_REQUERIDO' }
$count = & "$bin\psql.exe" @common -d $template -Atc 'SELECT (SELECT count(*) FROM ventas)+(SELECT count(*) FROM facturas_siat)'
if ($LASTEXITCODE -ne 0 -or $count -ne '0' -or $database -notmatch '^nuvoo_9b_concurrent_[a-f0-9]{32}$') { throw 'PLANTILLA_NO_VACIA' }
& "$bin\createdb.exe" -h 127.0.0.1 -p 55450 -U postgres -T $template $database
if ($LASTEXITCODE -ne 0) { throw 'BASE_SINTETICA_NO_CREADA' }
$sql = Get-Content -LiteralPath 'tests/siat/offline-real-import-local.sql' -Raw -Encoding UTF8
$marker = '  result:=public.siat_importar_factura_offline_v2('
$replacement = @'
  CREATE TABLE public.test_9b_payload(payload jsonb NOT NULL);
  INSERT INTO public.test_9b_payload VALUES(payload);
END $$;
COMMIT;
'@
$position = $sql.IndexOf($marker)
if ($position -lt 0) { throw 'FIXTURE_NO_RECONOCIDO' }
$setup = $sql.Substring(0, $position) + $replacement
$path = Join-Path $env:TEMP ($database + '.sql')
[System.IO.File]::WriteAllText($path, $setup, (New-Object System.Text.UTF8Encoding $false))
& "$bin\psql.exe" @common -d $database -f $path | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'FIXTURE_NO_CREADO' }
$query = "BEGIN; SELECT public.siat_importar_factura_offline_v2('TEST-AGENT',payload) FROM public.test_9b_payload; SELECT pg_sleep(1); COMMIT;"
$jobs = 1..2 | ForEach-Object { Start-Job -ArgumentList "$bin\psql.exe",$database,$query -ScriptBlock { param($exe,$db,$sql) & $exe -h 127.0.0.1 -p 55450 -U postgres -d $db -v ON_ERROR_STOP=1 -qAtc $sql; if($LASTEXITCODE -ne 0){throw 'IMPORTACION_CONCURRENTE_FALLIDA'} } }
$jobs | Wait-Job | Out-Null
$results = @($jobs | Receive-Job | Where-Object { $_ -match '^[a-f0-9-]{36}$' })
if (@($jobs | Where-Object { $_.State -ne 'Completed' }).Count -gt 0 -or $results.Count -ne 2 -or $results[0] -ne $results[1]) { throw 'CONCURRENCIA_NO_IDEMPOTENTE' }
$verify = & "$bin\psql.exe" @common -d $database -Atc "SELECT (SELECT count(*) FROM ventas)=1 AND (SELECT count(*) FROM facturas_siat)=1 AND (SELECT count(*) FROM movimientos_inventario WHERE tipo_movimiento='salida' AND cantidad=1)=1 AND (SELECT cantidad_disponible FROM stock_por_almacen)=9 AND (SELECT precio_pieza FROM productos WHERE codigo_interno='TEST-PERNO')=9 AND (SELECT venta_id FROM facturas_siat)=(SELECT id FROM ventas)"
if ($LASTEXITCODE -ne 0 -or $verify -ne 't') { throw 'VENTAS_O_INVENTARIO_DUPLICADOS' }
Write-Output 'Dos importaciones concurrentes reales: una venta, una factura y un solo movimiento; precio de producto intacto.'
