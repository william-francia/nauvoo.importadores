import { Fragment } from "react";
import { ChevronDown, ChevronUp, Pencil } from "lucide-react";

import { UBICACIONES } from "../constants/inventario.constants";
import { totalProducto } from "../hooks/useInventarioProductos";

import type { InventarioProducto } from "../types/inventario.types";

interface Props {
  productos: InventarioProducto[];
  filasExpandidas: Set<string>;
  onToggleFila: (productoId: string) => void;
  onEditarInventario: (producto: InventarioProducto) => void;
}

function estadoStock(total: number) {
  if (total <= 0) return { texto: "Sin stock", clase: "danger" };
  if (total < 50) return { texto: "Stock bajo", clase: "warning" };
  return { texto: "Con stock", clase: "success" };
}

export default function StockProductosTable({
  productos,
  filasExpandidas,
  onToggleFila,
  onEditarInventario,
}: Props) {
  return (
    <div className="inv-table-scroll">
      <table className="inv-table">
        <thead>
          <tr>
            <th>Acción</th>
            <th>ID</th>
            <th>Producto</th>
            <th>Stock total</th>
            <th>Ver más</th>
          </tr>
        </thead>
        <tbody>
          {productos.map((producto) => {
            const total = totalProducto(producto);
            const estado = estadoStock(total);
            const expandida = filasExpandidas.has(producto.id);

            return (
              <Fragment key={producto.id}>
                <tr>
                  <td>
                    <button
                      type="button"
                      className="inv-edit-button"
                      onClick={() => onEditarInventario(producto)}
                    >
                      <Pencil size={13} aria-hidden="true" />
                      Editar inventario
                    </button>
                  </td>
                  <td>{producto.codigo}</td>
                  <td><strong>{producto.nombre}</strong></td>
                  <td><strong>{total}</strong></td>
                  <td>
                    <button
                      type="button"
                      className="inv-expand-button"
                      aria-expanded={expandida}
                      onClick={() => onToggleFila(producto.id)}
                    >
                      <span className={`inv-dot inv-dot--${estado.clase}`} />
                      {estado.texto}
                      {expandida
                        ? <ChevronUp size={14} aria-hidden="true" />
                        : <ChevronDown size={14} aria-hidden="true" />}
                    </button>
                  </td>
                </tr>

                {expandida && (
                  <tr className="inv-location-row">
                    <td colSpan={5}>
                      <div className="inv-location-details">
                        <strong className="inv-location-title">
                          Stock por ubicación:
                        </strong>
                        <div className="inv-location-grid">
                          {UBICACIONES.map((ubicacion) => (
                            <div key={ubicacion.id}>
                              <span>{ubicacion.corto}</span>
                              <strong>{producto.stock[ubicacion.id]}</strong>
                            </div>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {productos.length === 0 && (
        <div className="inv-empty-state">No se encontraron productos.</div>
      )}
    </div>
  );
}

