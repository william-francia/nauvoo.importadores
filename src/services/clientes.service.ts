import { supabase } from "../lib/supabase";

import type {
  Cliente,
  CrearClienteInput,
  EditarClienteInput,
} from "../types/cliente.types";

const CLIENTES_TABLE = "clientes";

/* =========================================================
   OBTENER CLIENTES
========================================================= */

export async function obtenerClientes(): Promise<
  Cliente[]
> {
  const { data, error } = await supabase
    .from(CLIENTES_TABLE)
    .select("*")
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    console.error(
      "Error obteniendo clientes:",
      error
    );

    throw new Error(
      "No se pudieron cargar los clientes."
    );
  }

  return (data ?? []) as Cliente[];
}

/* =========================================================
   OBTENER CLIENTE
========================================================= */

export async function obtenerClientePorId(
  clienteId: string
): Promise<Cliente> {
  const { data, error } = await supabase
    .from(CLIENTES_TABLE)
    .select("*")
    .eq("id", clienteId)
    .single();

  if (error) {
    console.error(
      "Error obteniendo cliente:",
      error
    );

    throw new Error(
      "No se pudo obtener el cliente."
    );
  }

  return data as Cliente;
}

/* =========================================================
   CREAR
========================================================= */

export async function crearCliente(
  input: CrearClienteInput
): Promise<Cliente> {
  const payload = {
    tipo_documento: input.tipo_documento,

    razon_social: input.razon_social.trim(),

    numero_documento:
      input.numero_documento.trim(),

    complemento:
      input.complemento?.trim() || null,

    correo: input.correo.trim(),

    telefono:
      input.telefono?.trim() || null,

    estado: "habilitado",
  };

  const { data, error } = await supabase
    .from(CLIENTES_TABLE)
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error(
      "Error creando cliente:",
      error
    );

    /*
     * PostgreSQL:
     * 23505 = unique_violation
     */

    if (error.code === "23505") {
      throw new Error(
        "Ya existe un cliente con esos datos únicos."
      );
    }

    throw new Error(
      "No se pudo crear el cliente."
    );
  }

  return data as Cliente;
}

/* =========================================================
   EDITAR
========================================================= */

export async function editarCliente(
  clienteId: string,
  input: EditarClienteInput
): Promise<Cliente> {
  const payload = {
    tipo_documento: input.tipo_documento,

    razon_social: input.razon_social.trim(),

    numero_documento:
      input.numero_documento.trim(),

    complemento:
      input.complemento?.trim() || null,

    correo: input.correo.trim(),

    telefono:
      input.telefono?.trim() || null,
  };

  const { data, error } = await supabase
    .from(CLIENTES_TABLE)
    .update(payload)
    .eq("id", clienteId)
    .select()
    .single();

  if (error) {
    console.error(
      "Error editando cliente:",
      error
    );

    if (error.code === "23505") {
      throw new Error(
        "Ya existe otro cliente con esos datos."
      );
    }

    throw new Error(
      "No se pudieron guardar los cambios."
    );
  }

  return data as Cliente;
}

/* =========================================================
   RESTRINGIR
========================================================= */

export async function restringirCliente(
  clienteId: string
): Promise<Cliente> {
  const { data, error } = await supabase
    .from(CLIENTES_TABLE)
    .update({
      estado: "restringido",
    })
    .eq("id", clienteId)
    .select()
    .single();

  if (error) {
    console.error(
      "Error restringiendo cliente:",
      error
    );

    throw new Error(
      "No se pudo restringir el cliente."
    );
  }

  return data as Cliente;
}

/* =========================================================
   HABILITAR
========================================================= */

export async function habilitarCliente(
  clienteId: string
): Promise<Cliente> {
  const { data, error } = await supabase
    .from(CLIENTES_TABLE)
    .update({
      estado: "habilitado",
    })
    .eq("id", clienteId)
    .select()
    .single();

  if (error) {
    console.error(
      "Error habilitando cliente:",
      error
    );

    throw new Error(
      "No se pudo habilitar el cliente."
    );
  }

  return data as Cliente;
}

/* =========================================================
   RESTRINGIR VARIOS
========================================================= */

export async function restringirClientes(
  clienteIds: string[]
): Promise<void> {
  if (clienteIds.length === 0) return;

  const { error } = await supabase
    .from(CLIENTES_TABLE)
    .update({
      estado: "restringido",
    })
    .in("id", clienteIds);

  if (error) {
    console.error(
      "Error restringiendo clientes:",
      error
    );

    throw new Error(
      "No se pudieron restringir los clientes."
    );
  }
}

/* =========================================================
   HABILITAR VARIOS
========================================================= */

export async function habilitarClientes(
  clienteIds: string[]
): Promise<void> {
  if (clienteIds.length === 0) return;

  const { error } = await supabase
    .from(CLIENTES_TABLE)
    .update({
      estado: "habilitado",
    })
    .in("id", clienteIds);

  if (error) {
    console.error(
      "Error habilitando clientes:",
      error
    );

    throw new Error(
      "No se pudieron habilitar los clientes."
    );
  }
}

/* =========================================================
   ELIMINAR
========================================================= */

export async function eliminarClientes(
  clienteIds: string[]
): Promise<void> {
  if (clienteIds.length === 0) return;

  const { error } = await supabase
    .from(CLIENTES_TABLE)
    .delete()
    .in("id", clienteIds);

  if (error) {
    console.error(
      "Error eliminando clientes:",
      error
    );

    throw new Error(
      "No se pudieron eliminar los clientes."
    );
  }
}