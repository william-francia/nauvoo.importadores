# Agente local SIAT

Servicio Node.js/TypeScript compartido por las cajas de una sucursal. Permite facturación de contingencia sin Internet ni Supabase, con SQLite WASM persistido como snapshot AES-256-GCM y diario cifrado reanudable.

Garantiza cola tras reinicio, numeración y stock serializados, idempotencia, XML/XSD/XMLDSig, PDF, CAFC separado, documentos privados y recuperación reanudable.

Configure las variables sin prefijo `VITE_` de `.env.example`. `SIAT_AGENT_DEFAULT_EVENT_CODE` debe ser un código oficial sincronizado y aplicable; el agente no inventa uno.

```text
npm run typecheck:agent
npm run agent:start
```

Mantenga el directorio de datos con permisos del usuario de servicio. No comparta `SIAT_AGENT_STORAGE_KEY` con las cajas.
