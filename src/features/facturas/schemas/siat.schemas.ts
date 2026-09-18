import { z } from "zod";

export const configuracionSiatSchema = z.object({
  nit: z.string().trim().max(30),
  razonSocial: z.string().trim().max(200),
  nombreComercial: z.string().trim().max(200),
  municipio: z.string().trim().max(120),
  domicilio: z.string().trim().max(300),
  telefono: z.string().trim().max(50),
  codigoSistema: z.string().trim().max(100),
  modalidad: z.enum(["COMPUTARIZADA", "ELECTRONICA"]),
  documentoSector: z.string().trim().regex(/^\d*$/, "El documento sector debe ser numérico."),
  tipoFactura: z.string().trim().regex(/^\d*$/, "El tipo de factura debe ser numérico."),
  actividadEconomica: z.string().trim().max(100),
  ambiente: z.literal("PRUEBAS"),
  versionNormativa: z.enum(["SIAT_VIGENTE", "SIAT_LEY_1733_PILOTO"]),
  zonaHoraria: z.literal("America/La_Paz"),
  siatHabilitado: z.boolean(),
  sucursalPredeterminadaId: z.string(),
  puntoVentaPredeterminadoId: z.string(),
}).superRefine((value, context) => {
  if (value.versionNormativa === "SIAT_LEY_1733_PILOTO" && value.siatHabilitado) {
    context.addIssue({ code: "custom", path: ["siatHabilitado"], message: "La versión piloto no puede habilitar operaciones reales." });
  }
  if (value.siatHabilitado && !z.string().uuid().safeParse(value.sucursalPredeterminadaId).success) {
    context.addIssue({ code: "custom", path: ["sucursalPredeterminadaId"], message: "Selecciona la sucursal tributaria predeterminada." });
  }
});

export const homologacionProductoSchema = z.object({
  codigoProductoSin: z.string().trim().min(1, "Selecciona un producto/servicio SIN."),
  actividadEconomica: z.string().trim().min(1, "Selecciona una actividad económica."),
  unidadMedidaSin: z.string().trim().min(1, "Selecciona una unidad de medida SIN."),
  origen: z.enum(["NACIONAL", "IMPORTADO", "SERVICIO"]),
  versionCatalogo: z.string().trim().max(80),
});

export const contingenciaSchema = z.object({
  sucursalId: z.string().uuid("Selecciona una sucursal."),
  puntoVentaId: z.string().uuid("Selecciona un punto de venta."),
  tipoEventoCodigo: z.string().trim().min(1, "Selecciona el tipo de evento."),
  descripcion: z.string().trim().min(3, "Describe brevemente el evento."),
  fechaInicio: z.string().min(1, "Indica la fecha y hora de inicio."),
  cufdId: z.string().uuid("Selecciona el CUFD asociado."),
  observaciones: z.string().trim().max(500),
});

export type HomologacionProductoInput = z.infer<typeof homologacionProductoSchema>;
