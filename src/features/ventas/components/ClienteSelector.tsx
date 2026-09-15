import {
  useEffect,
  useRef,
  useState,
} from "react";

import { buscarClientes } from "../services/ventas.api";

import type {
  ClienteVenta,
} from "../types/ventas.types";

interface Props {
  cliente: ClienteVenta | null;

  onSeleccionar: (
    cliente: ClienteVenta | null
  ) => void;

  onNuevoCliente: () => void;
}

export default function ClienteSelector({
  cliente,
  onSeleccionar,
  onNuevoCliente,
}: Props) {
  const [texto, setTexto] =
    useState("");

  const [resultados, setResultados] =
    useState<ClienteVenta[]>([]);

  const [abierto, setAbierto] =
    useState(false);

  const [cargando, setCargando] =
    useState(false);

  const contenedor =
    useRef<HTMLDivElement>(null);

  useEffect(() => {
    function cerrar(event: MouseEvent) {
      if (
        contenedor.current &&
        !contenedor.current.contains(
          event.target as Node
        )
      ) {
        setAbierto(false);
      }
    }

    document.addEventListener(
      "mousedown",
      cerrar
    );

    return () =>
      document.removeEventListener(
        "mousedown",
        cerrar
      );
  }, []);

  useEffect(() => {
    if (
      !abierto ||
      cliente ||
      texto.trim().length < 1
    ) {
      return;
    }

    const timer = window.setTimeout(
      async () => {
        try {
          setCargando(true);

          const clientes =
            await buscarClientes(texto);

          setResultados(clientes);
        } catch {
          setResultados([]);
        } finally {
          setCargando(false);
        }
      },
      280
    );

    return () =>
      window.clearTimeout(timer);
  }, [texto, abierto, cliente]);

  function seleccionar(
    item: ClienteVenta
  ) {
    onSeleccionar(item);
    setTexto(
      item.nombre_razon_social
    );
    setResultados([]);
    setAbierto(false);
  }

  return (
    <div
      className="cliente-selector"
      ref={contenedor}
    >
      <div className="venta-section-title">
        <span>Cliente</span>
      </div>

      <div className="cliente-search-row">
        <div className="cliente-search">
          <span className="cliente-search__icon">
            ⌕
          </span>

          <input
            value={cliente?.nombre_razon_social ?? texto}
            placeholder="Buscar cliente..."
            onFocus={() =>
              setAbierto(true)
            }
            onChange={(e) => {
              setTexto(e.target.value);

              if (cliente) {
                onSeleccionar(null);
              }

              setAbierto(true);
            }}
          />

          {(cliente?.nombre_razon_social ?? texto) && (
            <button
              type="button"
              onClick={() => {
                setTexto("");
                onSeleccionar(null);
                setResultados([]);
              }}
            >
              ×
            </button>
          )}

          {abierto &&
            !cliente &&
            texto.trim() && (
              <div className="venta-dropdown">
                {cargando && (
                  <div className="venta-dropdown__message">
                    Buscando clientes...
                  </div>
                )}

                {!cargando &&
                  resultados.map(
                    (item) => (
                      <button
                        type="button"
                        key={item.id}
                        className="cliente-result"
                        onClick={() =>
                          seleccionar(item)
                        }
                      >
                        <strong>
                          {
                            item.nombre_razon_social
                          }
                        </strong>

                        <span>
                          {item.numero_documento
                            ? `Documento: ${item.numero_documento}`
                            : "Sin documento"}

                          {item.codigo_cliente
                            ? ` · ${item.codigo_cliente}`
                            : ""}
                        </span>
                      </button>
                    )
                  )}

                {!cargando &&
                  resultados.length === 0 && (
                    <div className="venta-dropdown__message">
                      No encontramos
                      clientes.
                    </div>
                  )}
              </div>
            )}
        </div>

        <button
          type="button"
          className="cliente-add-button"
          title="Registrar nuevo cliente"
          onClick={onNuevoCliente}
        >
          <span>👤</span>
          <b>+</b>
        </button>
      </div>

      {cliente && (
        <div className="cliente-seleccionado">
          <div className="cliente-seleccionado__avatar">
            {cliente.nombre_razon_social
              .charAt(0)
              .toUpperCase()}
          </div>

          <div>
            <strong>
              {
                cliente.nombre_razon_social
              }
            </strong>

            <span>
              {cliente.numero_documento ||
                "Sin documento"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
