export type ClienteEstado =
  | 'habilitado'
  | 'restringido'

export type TipoDocumento =
  | 'CI'
  | 'CEX'
  | 'NIT'
  | 'PASAPORTE'
  | 'OTRO'

export interface Cliente {
  id: string
  codigo: string

  tipo_documento: TipoDocumento
  razon_social: string
  numero_documento: string
  complemento: string | null

  correo: string
  telefono: string | null

  estado: ClienteEstado

  created_at: string
  updated_at: string
}

export interface CrearClienteInput {
  tipo_documento: TipoDocumento
  razon_social: string
  numero_documento: string

  complemento?: string | null
  correo: string
  telefono?: string | null
}

export interface EditarClienteInput {
  tipo_documento: TipoDocumento
  razon_social: string
  numero_documento: string

  complemento?: string | null
  correo: string
  telefono?: string | null
}
