// src/pages/productos/InventarioProductosPage.tsx

import "../../features/productos/styles/productos.css";

export default function InventarioProductosPage() {
  return (
    <div className="productos-page">
      <header className="productos-page-header">
        <div>
          <div className="productos-breadcrumb">
            Productos
            <span>›</span>
            Inventario de productos
          </div>

          <h1>
            Inventario de Productos
          </h1>

          <p>
            En esta sección se
            gestionarán posteriormente
            las cantidades por local,
            entradas, salidas y
            transferencias.
          </p>
        </div>
      </header>

      <div className="productos-coming-soon">
        <strong>
          Inventario de productos
        </strong>

        <span>
          Esta sección será el siguiente
          paso.
        </span>
      </div>
    </div>
  );
}