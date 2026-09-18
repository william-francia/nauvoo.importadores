# Matriz de fallos SIAT

| Caso | Respuesta implementada |
|---|---|
| Internet cae antes/después de enviar | Reintento o `SIN_RESPUESTA` + conciliación; nunca reemisión ciega |
| SIN, gateway o Supabase caen | Degradación diferenciada; emisión/cola local cifrada |
| Agente reinicia o navegador cierra | Diario + snapshot; frontend sin secretos |
| CUIS/CUFD/certificado vencido | Bloqueo fiscal previo |
| Hora desfasada | HMAC con ventana de cinco minutos y fechas La Paz |
| Catálogo/homologación incompleta | Bloqueo por producto, leyenda o pago |
| Doble clic/worker | Idempotencia y `SKIP LOCKED` |
| Dos cajas/último stock | Mutex local + transacción SQLite |
| Paquete observado | 904 y mensajes por archivo/detalle |
| Recuperación incompleta | Evento cerrado reanudable y backoff |

Las pruebas contra el SIN no se marcan aprobadas sin credenciales reales.
