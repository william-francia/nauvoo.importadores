# Paso 9B: preparación operativa

Estado: las migraciones 0600–0800 y las funciones Edge ya fueron publicadas. La operación de contingencia sigue deshabilitada; no se autoriza ninguna transmisión por este documento.

Los cambios locales pendientes corresponden al agente (`agent-local/src/app.ts`, `server.ts` y `store.ts`) y a las pantallas de contingencias, eventos y venta offline. El frontend local con Vite utiliza estos archivos; una publicación del frontend a otro destino requiere autorización independiente. Reiniciar el agente no lo configura ni habilita operaciones.

## Requisitos antes de aprovisionar

- Confirmar que `ph1234` tiene una homologación aprobada y vigente. La copia local del catálogo SIAT consultada el 12/11/2026 contiene el producto 1003451, actividad 4752100 y unidad 47, pero su sincronización de productos es del 01/10/2026. No confundir su estado local `VIGENTE` con una consulta actual al SIN.
- Registrar, con autorización y permisos administrativos, un agente para la sucursal y punto de venta correspondientes. En la última consulta no había agentes activos.
- Configurar de forma privada el código del agente y sus claves de comunicación y almacenamiento: `SIAT_AGENT_CODE`, `SIAT_AGENT_SHARED_SECRET`, `SIAT_AGENT_STORAGE_KEY`, `SUPABASE_URL` y `SUPABASE_ANON_KEY`. La firma electrónica local necesita además `SIAT_PRIVATE_KEY_PEM` y `SIAT_CERTIFICATE_PEM`. Nunca incluir sus valores en el repositorio, la interfaz ni registros.
- Para activar 9B se requiere autorización específica y configuración coordinada del interruptor y del código de agente tanto en Edge como en el agente local. Mantener `siat_habilitado=false` para ventas generales. Las rutas CAFC y los casos que dependen de evidencia o autorización permanecen bloqueados.
- El aprovisionamiento reserva un bloque de numeración: no ejecutarlo durante la preparación ni mientras existan eventos o documentos sin recuperar.

## Prueba mínima posterior, con autorización separada

1. Confirmar un evento real, su evidencia, un CUIS/CUFD vigente, la clasificación del producto y el comprador. No registrar un corte ficticio ante el SIN.
2. Revisar y autorizar expresamente una única venta real con cantidad, precio, pago e impacto de inventario identificados. Mantener intactas las facturas piloto 1–3.
3. Cuando se produzca el evento, revisar el estado offline y el documento firmado local. Una respuesta dudosa no autoriza crear otra venta.
4. Tras recuperar comunicación, autorizar el registro oficial y el envío del paquete; verificar respuesta, conciliación individual y persistencia sin reenvíos automáticos ante incertidumbre.

La prueba integrada local de `tests/siat/contingency-integral.test.ts` utiliza SIN y persistencia remota simulados; las pruebas SQL locales comprueban por separado el importador y la concurrencia. La prueba Edge de rechazo solo comprobó autenticación y acceso de lectura a una RPC. Ninguna demuestra el circuito completo ante Edge o el SIN.
