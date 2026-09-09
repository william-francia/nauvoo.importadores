import { useState } from "react";
import { useNavigate } from "react-router";
import "../../features/productos/styles/productos.css";
import ProductosTable from "../../features/productos/components/ProductosTable";
import ProductoPreviewModal from "../../features/productos/components/ProductoPreviewModal";
import { PRODUCTOS_MOCK } from "../../features/productos/data/productos.mock";
import { useGestionProductos } from "../../features/productos/hooks/useGestionProductos";
import type { Producto } from "../../features/productos/types/productos.types";

export default function GestionProductosPage() {
  const navigate = useNavigate();
  const gestion = useGestionProductos(PRODUCTOS_MOCK);
  const [preview, setPreview] = useState<Producto | null>(null);

  return (
    <div className="productos-page">
      <header className="productos-page-header">
        <div>
          <div className="productos-breadcrumb">
            Productos <span>›</span> Gestión de productos
          </div>
          <h1>Gestión de Productos</h1>
          <p>Consulta, filtra y administra tus productos.</p>
        </div>
        <div className="productos-header-actions">
          <button className="productos-btn productos-btn--ghost" type="button" onClick={() => navigate("/productos/inventario")}>
            Inventario
          </button>
          <button className="productos-btn productos-btn--primary" type="button" onClick={() => navigate("/productos/nuevo")}>
            + Nuevo producto
          </button>
        </div>
      </header>

      <section className="productos-card">
        <div className="productos-toolbar">
          <span>{gestion.productosFiltrados.length} productos</span>
          <button className="productos-btn productos-btn--ghost" type="button" onClick={gestion.limpiarFiltros}>
            Limpiar filtros
          </button>
          <button className="productos-btn productos-btn--danger" type="button" onClick={gestion.eliminarSeleccionados} disabled={gestion.seleccionados.size === 0}>
            Eliminar seleccionados
          </button>
        </div>

        <ProductosTable
          productos={gestion.productosPagina}
          filters={gestion.filters}
          seleccionados={gestion.seleccionados}
          onFilterChange={gestion.actualizarFiltro}
          onToggleProducto={gestion.toggleProducto}
          onTogglePagina={gestion.togglePagina}
          onPreview={setPreview}
          onEdit={(producto) => navigate(`/productos/${producto.id}/editar`)}
        />

        <footer className="productos-pagination">
          <span>{gestion.productosFiltrados.length} resultados</span>
          <button className="productos-btn productos-btn--ghost" type="button" disabled={gestion.pagina <= 1} onClick={() => gestion.setPagina(gestion.pagina - 1)}>
            Anterior
          </button>
          <span>Página {gestion.pagina} de {gestion.totalPaginas}</span>
          <button className="productos-btn productos-btn--ghost" type="button" disabled={gestion.pagina >= gestion.totalPaginas} onClick={() => gestion.setPagina(gestion.pagina + 1)}>
            Siguiente
          </button>
        </footer>
      </section>

      <ProductoPreviewModal producto={preview} onCerrar={() => setPreview(null)} onEditar={(producto) => navigate(`/productos/${producto.id}/editar`)} />
    </div>
  );
}
