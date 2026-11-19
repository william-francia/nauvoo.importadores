# Agente local SIAT

Servicio Node.js/TypeScript compartido por las cajas de una sucursal. Permite facturación de contingencia sin Internet ni Supabase, con SQLite WASM persistido como snapshot AES-256-GCM y diario cifrado reanudable.

Garantiza cola tras reinicio, numeración y stock serializados, idempotencia, XML/XSD/XMLDSig, PDF, CAFC separado, documentos privados y recuperación reanudable.

Configure las variables sin prefijo `VITE_` de `.env.example`. `SIAT_AGENT_DEFAULT_EVENT_CODE` debe ser un código oficial sincronizado y aplicable; el agente no inventa uno.

Antes de autorizar el aprovisionamiento fiscal configure `SIAT_AGENT_RESERVA_CANTIDAD` con la cantidad expresamente decidida para el punto de venta. No existe una reserva predeterminada; reaprovicionar devuelve el bloque ya asignado. La reserva y la emisión continúan sujetas a los controles y autorizaciones fiscales.

```text
npm run typecheck:agent
npm run agent:start
```

Mantenga el directorio de datos con permisos del usuario de servicio. No comparta `SIAT_AGENT_STORAGE_KEY` con las cajas.
