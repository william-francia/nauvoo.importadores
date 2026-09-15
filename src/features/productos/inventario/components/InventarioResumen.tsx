import { ArrowLeftRight, PackageCheck, Store, Warehouse } from "lucide-react";

import { TIENDAS } from "../constants/inventario.constants";

interface Props {
  productosConStock: number;
  totalProductos: number;
  movimientosSemana: number;
}

export default function InventarioResumen({
  productosConStock,
  totalProductos,
  movimientosSemana,
}: Props) {
  const porcentaje =
    totalProductos === 0
      ? 0
      : Math.round((productosConStock / totalProductos) * 100);

  return (
    <div className="inv-summary">
      <section className="inv-summary-card">
        <div className="inv-summary-stock">
          <div className="inv-summary-icon inv-summary-icon--green">
            <PackageCheck aria-hidden="true" />
          </div>
          <div>
            <span>Productos con stock</span>
            <strong>{productosConStock}</strong>
            <small>de {totalProductos} productos</small>
          </div>
        </div>
        <div className="inv-progress" aria-label={`${porcentaje}% con stock`}>
          <div style={{ width: `${porcentaje}%` }} />
        </div>
        <b className="inv-progress-value">{porcentaje}%</b>
      </section>

      <section className="inv-summary-card inv-flow-card">
        <div>
          <strong>Traslado desde almacén a locales</strong>
          <small>Mueve productos del almacén principal a los locales.</small>
        </div>

        <div className="inv-flow">
          <div className="inv-flow-origin">
            <Warehouse aria-hidden="true" />
            <strong>Almacén Uquisamaña</strong>
            <small>Origen</small>
          </div>
          <div className="inv-flow-line"><span /></div>
          <div className="inv-flow-destinations">
            {TIENDAS.map((tienda) => (
              <div key={tienda.id} className="inv-flow-destination">
                <Store aria-hidden="true" />
                <strong>{tienda.corto}</strong>
                <small>Local</small>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="inv-summary-card">
        <div className="inv-summary-stock">
          <div className="inv-summary-icon inv-summary-icon--blue">
            <ArrowLeftRight aria-hidden="true" />
          </div>
          <div>
            <span>Movimientos de la semana</span>
            <strong>{movimientosSemana}</strong>
            <small>ingresos, ajustes y traslados</small>
          </div>
        </div>
      </section>
    </div>
  );
}

