import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import "../../features/productos/styles/productos.css";
import ProductosTable from "../../features/productos/components/ProductosTable";
import ProductoPreviewModal from "../../features/productos/components/ProductoPreviewModal";
import { useGestionProductos } from "../../features/productos/hooks/useGestionProductos";
import { useEliminarProductos, useProductos } from "../../features/productos/hooks/useProductos";
import type { Producto } from "../../features/productos/types/productos.types";
import ProductoHomologacionModal from "../../features/productos/components/ProductoHomologacionModal";
import { listarHomologacionesProductos } from "../../features/facturas/services/siat.service";
import type { ProductoHomologacion } from "../../features/facturas/types/siat.types";
import { usePermissions } from "../../features/account/hooks/useCurrentAccount";

export default function GestionProductosPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const productoGuardado = (location.state as { productoGuardado?: string } | null)?.productoGuardado;
  const permissions = usePermissions();
  const productosQuery = useProductos();
  const eliminarMutation = useEliminarProductos();
  const homologacionesQuery = useQuery({queryKey:["siat-productos-homologacion"],queryFn:listarHomologacionesProductos,enabled:permissions.can("invoices.read")});
  const homologaciones = new Map<string,ProductoHomologacion>();
  for(const item of homologacionesQuery.data??[]){homologaciones.set(item.productoId,item);homologaciones.set(item.codigoInterno.toUpperCase(),item)}
  const homologados = new Set([...homologaciones.entries()].filter(([,value])=>value.estado==="HOMOLOGADO").map(([key])=>key));
  const gestion = useGestionProductos(productosQuery.data ?? [],homologados);
  const [preview, setPreview] = useState<Producto | null>(null);
  const [homologar,setHomologar]=useState<ProductoHomologacion|null>(null);

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
          {permissions.can("inventory.read") && <button className="productos-btn productos-btn--ghost" type="button" onClick={() => navigate("/productos/inventario")}>
            Inventario
          </button>}
          {permissions.can("products.create") && <button className="productos-btn productos-btn--primary" type="button" onClick={() => navigate("/productos/nuevo")}>
            + Nuevo producto
          </button>}
        </div>
      </header>

      <section className="productos-card">
        {productoGuardado && <div className="producto-form-success">{productoGuardado}</div>}
        {productosQuery.isLoading && <div className="producto-form-info">Cargando productos reales desde Supabase…</div>}
        {productosQuery.error && <div className="producto-form-error">{productosQuery.error.message}</div>}
        {eliminarMutation.error && <div className="producto-form-error">{eliminarMutation.error.message}</div>}
        {homologacionesQuery.error && <div className="producto-form-error">{homologacionesQuery.error.message}</div>}
        <div className="productos-toolbar">
          <span>{gestion.productosFiltrados.length} productos</span>
          <button className="productos-btn productos-btn--ghost" type="button" onClick={gestion.limpiarFiltros}>
            Limpiar filtros
          </button>
          {permissions.can("products.delete") && <button className="productos-btn productos-btn--danger" type="button" onClick={() => eliminarMutation.mutate([...gestion.seleccionados], { onSuccess: gestion.limpiarSeleccion })} disabled={gestion.seleccionados.size === 0 || eliminarMutation.isPending}>
            {eliminarMutation.isPending ? "Eliminando…" : "Eliminar seleccionados"}
          </button>}
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
          homologaciones={homologaciones}
          onHomologar={setHomologar}
          canEdit={permissions.can("products.update")}
          canDelete={permissions.can("products.delete")}
          canManageInvoices={permissions.can("invoices.issue")}
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

      <ProductoPreviewModal producto={preview} onCerrar={() => setPreview(null)} onEditar={permissions.can("products.update") ? (producto) => navigate(`/productos/${producto.id}/editar`) : undefined} />
      {permissions.can("invoices.issue") && <ProductoHomologacionModal producto={homologar} onClose={()=>setHomologar(null)}/>}
    </div>
  );
}
