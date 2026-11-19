# Solo para la base sintética local; nunca conectar a Supabase.
$ErrorActionPreference = 'Stop'
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
$actor = [guid]::NewGuid().ToString()
$invoice = [guid]::NewGuid().ToString()
$key = [guid]::NewGuid().ToString()
$branch = [guid]::NewGuid().ToString()
$catalog = Get-Random -Minimum 1000000 -Maximum 2000000000
$setup = "UPDATE public.siat_configuracion SET ambiente='PRUEBAS' WHERE id=true; INSERT INTO public.usuarios (auth_user_id,activo,rol) VALUES ('$actor',true,'administrador'); INSERT INTO public.siat_catalogos(id,codigo,estado) VALUES ($catalog,'MOTIVOS_ANULACION','VIGENTE'); INSERT INTO public.siat_catalogo_items(catalogo_id,codigo,activo) VALUES ($catalog,'1',true); INSERT INTO public.siat_sucursales(id,codigo,activo) VALUES ('$branch',$catalog,true); INSERT INTO public.facturas_siat(id,ambiente,origen_fiscal,estado_fiscal,fecha_emision,sucursal_id,codigo_estado,transaccion,codigo_recepcion) VALUES ('$invoice','PRUEBAS','PILOTO','VALIDADA',now()-interval '1 day','$branch',908,true,'RECEPCION-SINTETICA');"
& $psql -h 127.0.0.1 -p 55449 -U postgres -d paso9_concurrent_v2 -v ON_ERROR_STOP=1 -c $setup | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar la base sintética.' }
$prepare = "SELECT public.siat_9a_guardar_notificacion('$invoice','$actor','ANULACION','CORREO',repeat('A',64),'c***@***.bo','PREPARAR',true,NULL);"
& $psql -h 127.0.0.1 -p 55449 -U postgres -d paso9_concurrent_v2 -v ON_ERROR_STOP=1 -Atc $prepare | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar el destinatario sintético.' }
$query = "SELECT public.siat_solicitar_operacion_factura_confirmada('$invoice','ANULAR','$actor',1,true,true,'$key');"
$jobs = 1..2 | ForEach-Object { Start-Job -ArgumentList $psql, $query -ScriptBlock { param($exe, $sql) & $exe -h 127.0.0.1 -p 55449 -U postgres -d paso9_concurrent_v2 -v ON_ERROR_STOP=1 -Atc $sql; if ($LASTEXITCODE -ne 0) { throw 'Falló una solicitud simultánea.' } } }
$jobs | Wait-Job | Out-Null
$results = @($jobs | Receive-Job)
if (($jobs | Where-Object { $_.State -ne 'Completed' }).Count -gt 0 -or $results.Count -ne 2 -or @($results | Where-Object { $_ -ne 'ANULACION_PENDIENTE' }).Count -gt 0) { throw 'La concurrencia no devolvió dos resultados idempotentes.' }
$count = & $psql -h 127.0.0.1 -p 55449 -U postgres -d paso9_concurrent_v2 -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM public.siat_outbox WHERE factura_id='$invoice'"
if ($LASTEXITCODE -ne 0 -or $count -ne '1') { throw 'La concurrencia generó una cantidad incorrecta de tareas.' }
Write-Output 'Dos solicitudes simultáneas; una sola tarea fiscal en la base sintética.'
