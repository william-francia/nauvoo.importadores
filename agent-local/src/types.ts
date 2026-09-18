export type OperationalState =
  | "ONLINE" | "DEGRADADO" | "INICIANDO_CONTINGENCIA" | "OFFLINE"
  | "RECUPERANDO" | "REGISTRANDO_EVENTO" | "EMPAQUETANDO"
  | "ENVIANDO_PAQUETES" | "VALIDANDO_PAQUETES";

export interface BootstrapBundle {
  config: Record<string, unknown>;
  branch: Record<string, unknown>;
  point: Record<string, unknown> | null;
  cuis: Record<string, unknown>;
  cufd: Record<string, unknown>;
  products: Array<Record<string, unknown>>;
  homologations: Array<Record<string, unknown>>;
  stocks: Array<Record<string, unknown>>;
  warehouses: Array<Record<string, unknown>>;
  clients: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  legends: Array<Record<string, unknown>>;
  cafc: Array<Record<string, unknown>>;
  rules: Array<Record<string, unknown>>;
  numberBlock: Record<string, unknown> | null;
  generatedAt: string;
}

export interface LocalSession { id: string; userId: string; userName: string; role: string; expiresAt: string }
export interface OfflineItemInput { productoId: string; almacenId: string; cantidad: number; precioUnitario: number; descuento: number; informacionExtra?: string }
export interface OfflineSaleInput {
  idempotencyKey: string;
  cajaId: string;
  clienteId: string;
  metodoPago: string;
  tarjetaOfuscada: string | null;
  descuentoAdicional: number;
  observacion?: string;
  items: OfflineItemInput[];
  manualCafc?: { rangeId: string; numero: number; evidenciaBase64: string; evidenciaMime: string };
}

export interface LocalInvoice {
  id: string; idempotencyKey: string; correlationId: string; cajaId: string;
  eventId: string; numeroFactura: number; cuf: string; fechaEmision: string;
  cliente: Record<string, unknown>; total: string; estado: string;
  paqueteId: string | null; xmlPath: string; pdfPath: string; xmlHash: string;
  snapshot: Record<string, unknown>; syncError: string | null; createdBy: string;
  manualCafc?: { rangeId: string; numero: number; autorizacion: string; evidencePath: string } | null;
}

export interface ConnectivityEvidence {
  browserOnline: boolean | null; internetOnline: boolean; backendOnline: boolean;
  siatOnline: boolean; specificService: string; checkedAt: string; detail?: string;
}
