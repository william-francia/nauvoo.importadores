import "../../features/productos/styles/productos.css";

export default function GestionProductosPage() {
  return (
    <div className="productos-page">
      <header className="productos-page-header">
        <div>
          <div className="productos-breadcrumb">
            Productos
            <span>›</span>
            Gestión de productos
          </div>
          <h1>Gestión de Productos</h1>
          <p>La administración de productos se conectará progresivamente al inventario.</p>
        </div>
      </header>
    </div>
  );
}
