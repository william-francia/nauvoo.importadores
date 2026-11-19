# Solo PostgreSQL sintético en localhost; no llama al SIN.
$ErrorActionPreference = 'Stop'
$bin = 'C:\Program Files\PostgreSQL\18\bin'
$dbName = 'nuvoo_cafc_test_' + [guid]::NewGuid().ToString('N')
$actor = [guid]::NewGuid().ToString(); $userId = [guid]::NewGuid().ToString(); $client = [guid]::NewGuid().ToString()
$branch = [guid]::NewGuid().ToString(); $agent = [guid]::NewGuid().ToString(); $cuis = [guid]::NewGuid().ToString(); $cufd = [guid]::NewGuid().ToString()
$cafc = [guid]::NewGuid().ToString(); $event = [guid]::NewGuid().ToString(); $sale = [guid]::NewGuid().ToString(); $invoice = [guid]::NewGuid().ToString(); $correlation = [guid]::NewGuid().ToString()
& "$bin\createdb.exe" -h 127.0.0.1 -p 55449 -U postgres -T nuvoo_9b_cafc_0800_synthetic $dbName
if ($LASTEXITCODE -ne 0) { throw 'No se creó la base sintética.' }
try {
  $hashA = 'A' * 64; $hashB = 'B' * 64
  $xmlPath = "cafc/$event/$invoice/firmado.xml.gz"; $evidencePath = "cafc/$event/$invoice/original.bin"
  $setup = @"
INSERT INTO public.usuarios VALUES('$userId','$actor',true,'administrador');
INSERT INTO public.clientes VALUES('$client','Cliente test','CI','12345',NULL);
INSERT INTO public.siat_configuracion VALUES(true,'PRUEBAS','ELECTRONICA',false,'123456789');
INSERT INTO public.siat_sucursales VALUES('$branch',0);
INSERT INTO public.siat_agentes_locales VALUES('$agent','ACTIVO','$branch',NULL,'AGENTE_TEST');
INSERT INTO public.siat_cuis VALUES('$cuis','CUIS-TEST');
INSERT INTO public.siat_cufd VALUES('$cufd','$cuis','CUFD-TEST','PRUEBAS','$branch',NULL,now()-interval '3 hours',now()+interval '20 hours');
INSERT INTO public.siat_rangos_cafc VALUES('$cafc','$branch',NULL,'VIGENTE',now()-interval '2 days',now()+interval '2 days',50,60,'CAFC-TEST');
INSERT INTO public.siat_eventos_significativos VALUES('$event','$agent','5',now()-interval '2 hours',now()-interval '30 minutes','$cafc','$cufd','$branch',NULL,'Evento de prueba','{}',NULL,'MANUAL_ADMINISTRATIVO');
INSERT INTO public.siat_metodo_pago_mapeos VALUES('EFECTIVO',1,'SIAT_VIGENTE');
INSERT INTO public.ventas VALUES('$sale','$client','confirmada',true,5,0,'EFECTIVO');
INSERT INTO public.detalle_ventas VALUES(gen_random_uuid(),'$sale','P1','Perno',1,5,0,5);
INSERT INTO public.movimientos_inventario VALUES(gen_random_uuid(),'$sale',1);
INSERT INTO storage.objects VALUES('siat-documentos','$xmlPath'),('siat-documentos','$evidencePath');
CREATE TABLE public.test_payload(value jsonb);
INSERT INTO public.test_payload VALUES(jsonb_build_object('facturaId','$invoice','eventoId','$event','cafcId','$cafc','agenteId','$agent','numeroFactura',54,'fechaEmision',now()-interval '1 hour','idempotencyKey','cafc-concurrency-test-0001','xmlHash','$hashA','evidenciaHash','$hashB','xmlPath','$xmlPath','evidenciaPath','$evidencePath','nit','123456789','cuf','ABC123','cufd','CUFD-TEST','cafc','CAFC-TEST','codigoSucursal',0,'codigoPuntoVenta',0,'correlationId','$correlation','montoTotal','5','descuentoAdicional','0','numeroDocumento','12345','nombreRazonSocial','Cliente test','tipoDocumento',1,'codigoMetodoPago',1,'detalleSnapshot',jsonb_build_array(jsonb_build_object('codigoProducto','P1','descripcion','Perno','cantidad',1,'precioUnitario',5,'descuento',0,'subtotal',5)),'clienteSnapshot','{}'::jsonb,'totalesSnapshot','{}'::jsonb,'pagoSnapshot','{}'::jsonb,'qrContenido','qr-test','origenCaja','TEST'));
"@
  & "$bin\psql.exe" -h 127.0.0.1 -p 55449 -U postgres -d $dbName -v ON_ERROR_STOP=1 -c $setup | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'No se preparó el esquema sintético.' }
  $query = "BEGIN; SELECT public.siat_9b_vincular_cafc(value,'$sale','$actor',true) FROM public.test_payload; SELECT pg_sleep(0.5); COMMIT;"
  $jobs = 1..2 | ForEach-Object { Start-Job -ArgumentList "$bin\psql.exe",$dbName,$query -ScriptBlock { param($exe,$db,$sql) & $exe -h 127.0.0.1 -p 55449 -U postgres -d $db -v ON_ERROR_STOP=1 -qAtc $sql; if ($LASTEXITCODE -ne 0) { throw 'Falló la vinculación simultánea.' } } }
  $jobs | Wait-Job | Out-Null; $results = @($jobs | Receive-Job | Where-Object { $_ -match '"estado": "VINCULADA"' })
  if (($jobs | Where-Object { $_.State -ne 'Completed' }).Count -gt 0 -or $results.Count -ne 2) { throw 'Resultado concurrente no idempotente.' }
  $counts = & "$bin\psql.exe" -h 127.0.0.1 -p 55449 -U postgres -d $dbName -v ON_ERROR_STOP=1 -Atc 'SELECT (SELECT count(*) FROM public.ventas),(SELECT count(*) FROM public.movimientos_inventario),(SELECT count(*) FROM public.facturas_siat),(SELECT count(*) FROM public.siat_cafc_usos)'
  if ($LASTEXITCODE -ne 0 -or $counts -ne '1|1|1|1') { throw 'Se duplicó venta, movimiento, factura o CAFC.' }
  Write-Output 'Dos vinculaciones simultáneas; una venta, un movimiento y una factura sintética.'
} finally {
  if ($dbName -notmatch '^nuvoo_cafc_test_[0-9a-f]{32}$') { throw 'Nombre de base sintética inesperado.' }
  & "$bin\dropdb.exe" -h 127.0.0.1 -p 55449 -U postgres $dbName
}
