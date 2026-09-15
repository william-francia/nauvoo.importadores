import { useState } from "react";
import { Boxes, Download, PackagePlus, Search } from "lucide-react";

import EditarInventarioModal from "../../features/productos/inventario/components/EditarInventarioModal";
import IngresoProductosPanel from "../../features/productos/inventario/components/IngresoProductosPanel";
import InventarioResumen from "../../features/productos/inventario/components/InventarioResumen";
import StockProductosTable from "../../features/productos/inventario/components/StockProductosTable";
import TrasladoProductosPanel from "../../features/productos/inventario/components/TrasladoProductosPanel";
import { useInventarioProductos } from "../../features/productos/inventario/hooks/useInventarioProductos";
import "../../features/productos/inventario/styles/inventarioProductos.css";

import type { InventarioProducto } from "../../features/productos/inventario/types/inventario.types";

type InventarioTab = "inventario" | "ingresos";

export default function InventarioProductosPage() {
  const inventario = useInventarioProductos();
  const [tab, setTab] = useState<InventarioTab>("inventario");
  const [productoEditar, setProductoEditar] =
    useState<InventarioProducto | null>(null);

  return (
    <div className="inventario-productos-page">
      <header className="inv-page-header">
        <div className="inv-breadcrumb">
          Productos <span>›</span> Inventario de productos
        </div>
        <h1>Inventario de productos</h1>
        <p>
          Consulta y administra las cantidades de productos en almacén y locales.
        </p>
      </header>

      <nav className="inv-tabs" aria-label="Secciones de inventario">
        <button
          type="button"
          className={tab === "inventario" ? "inv-tab inv-tab--active" : "inv-tab"}
          onClick={() => setTab("inventario")}
        >
          <Boxes size={16} aria-hidden="true" />
          Inventario y traslados
        </button>
        <button
          type="button"
          className={tab === "ingresos" ? "inv-tab inv-tab--active" : "inv-tab"}
          onClick={() => setTab("ingresos")}
        >
          <PackagePlus size={16} aria-hidden="true" />
          Ingreso de productos
        </button>
      </nav>

      {tab === "inventario" ? (
        <>
          <InventarioResumen
            productosConStock={inventario.productosConStock}
            totalProductos={inventario.productos.length}
            movimientosSemana={inventario.movimientosSemana}
          />

          <div className="inv-main-layout">
            <section className="inv-stock-card">
              <div className="inv-stock-header">
                <div>
                  <h2><Boxes size={18} aria-hidden="true" /> Stock de productos</h2>
                  <p>
                    Edita las cantidades de productos existentes. Los productos ya
                    están creados.
                  </p>
                </div>
                <button type="button" className="inv-export-button">
                  <Download size={15} aria-hidden="true" /> Exportar
                </button>
              </div>

              <div className="inv-search">
                <Search size={15} aria-hidden="true" />
                <input
                  value={inventario.busqueda}
                  onChange={(event) => inventario.setBusqueda(event.target.value)}
                  placeholder="Buscar producto por nombre o ID..."
                  aria-label="Buscar producto"
                />
              </div>

              <StockProductosTable
                productos={inventario.productosFiltrados}
                filasExpandidas={inventario.filasExpandidas}
                onToggleFila={inventario.toggleFila}
                onEditarInventario={setProductoEditar}
              />
            </section>

            <TrasladoProductosPanel
              productos={inventario.productos}
              movimientos={inventario.movimientos}
              onTrasladar={inventario.registrarTraslado}
            />
          </div>
        </>
      ) : (
        <IngresoProductosPanel
          productos={inventario.productos}
          movimientos={inventario.movimientos}
          onRegistrar={inventario.registrarMovimiento}
          onAnular={inventario.anularMovimiento}
        />
      )}

      <EditarInventarioModal
        producto={productoEditar}
        movimientos={inventario.movimientos}
        onCerrar={() => setProductoEditar(null)}
        onGuardar={inventario.registrarMovimiento}
        onAnularMovimiento={inventario.anularMovimiento}
      />
    </div>
  );
}
