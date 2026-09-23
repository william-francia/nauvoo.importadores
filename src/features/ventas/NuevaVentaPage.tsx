import {
  useState,
} from "react";

import "./ventas.css";

import ClienteSelector from "./components/ClienteSelector";
import NuevoClienteModal from "./components/NuevoClienteModal";
import ProductoSelector from "./components/ProductoSelector";
import VentaItemsTable from "./components/VentaItemsTable";
import PagoPanel from "./components/PagoPanel";
import { AlertTriangle, X } from "lucide-react";

import { useVentaDraft } from "./hooks/useVentaDraft";

import {
  registrarVenta,
} from "./services/ventas.api";

import type {
  ClienteVenta,
  MetodoPago,
  ProductoVenta,
} from "./types/ventas.types";

function money(value: number) {
  return new Intl.NumberFormat(
    "es-BO",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  ).format(value);
}

export default function NuevaVentaPage() {
  const venta = useVentaDraft();

  const [
    modalClienteAbierto,
    setModalClienteAbierto,
  ] = useState(false);

  const [
    detalleExtraAbierto,
    setDetalleExtraAbierto,
  ] = useState(false);

  const [
    procesando,
    setProcesando,
  ] = useState(false);
  const [confirmarStockCero, setConfirmarStockCero] = useState(false);
  const [pagoPendiente, setPagoPendiente] = useState<{
    metodo: MetodoPago;
    montoRecibido: number;
    tarjetaOfuscada: string | null;
  } | null>(null);

  const [mensaje, setMensaje] =
    useState<{
      tipo: "success" | "error";
      texto: string;
    } | null>(null);

  function handleAgregarProducto(
    producto: ProductoVenta
  ) {
    try {
      venta.agregarProducto(producto);

      setMensaje(null);
    } catch (error) {
      setMensaje({
        tipo: "error",

        texto:
          error instanceof Error
            ? error.message
            : "No se pudo agregar el producto.",
      });
    }
  }

  function handleClienteCreado(
    cliente: ClienteVenta
  ) {
    venta.setCliente(cliente);

    setMensaje({
      tipo: "success",
      texto:
        "Cliente registrado y seleccionado.",
    });
  }

  async function registrarPago(data: {
    metodo: MetodoPago;
    montoRecibido: number;
    tarjetaOfuscada: string | null;
  }) {
    if (venta.lineas.length === 0) {
      return;
    }

    try {
      setProcesando(true);
      setMensaje(null);

      const respuesta =
        await registrarVenta({
          cliente_id:
            venta.cliente?.id ?? null,

          metodo_pago: data.metodo,

          tarjeta_ofuscada: data.tarjetaOfuscada,

          observacion:
            venta.observacion,

          descuento_venta:
            venta.totales
              .descuentoAdicional,

          items: venta.lineas.map(
            (linea) => ({
              producto_id:
                linea.producto.id,

              almacen_id:
                linea.almacen_id,

              cantidad:
                linea.cantidad,

              precio_unitario:
                linea.precio_unitario,

              descuento:
                linea.descuento,

            })
          ),
        });

      console.log(
        "Venta registrada:",
        respuesta
      );

      venta.limpiarVenta();

      setMensaje({
        tipo: "success",
        texto:
          "Venta registrada correctamente.",
      });
    } catch (error) {
      setMensaje({
        tipo: "error",

        texto:
          error instanceof Error
            ? error.message
            : "No se pudo registrar la venta.",
      });
    } finally {
      setProcesando(false);
    }
  }

  function handlePagar(data: { metodo: MetodoPago; montoRecibido: number; tarjetaOfuscada: string | null }) {
    const vendeSinStock = venta.lineas.some((linea) => {
      const stock = linea.producto.stocks.find((item) => item.almacen.id === linea.almacen_id);
      return (stock?.cantidad ?? 0) <= 0;
    });
    if (vendeSinStock) {
      setPagoPendiente(data);
      setConfirmarStockCero(true);
      return;
    }
    void registrarPago(data);
  }

  return (
    <div className="nueva-venta-page">
      <header className="venta-page-header">
        <div>
          <div className="venta-breadcrumb">
            Ventas
            <span>›</span>
            Registro de venta
          </div>

          <h1>Registrar Venta</h1>

          <p>
            Registra productos,
            selecciona la tienda de donde
            saldrá el stock y completa el
            pago.
          </p>
        </div>
      </header>

      {mensaje && (
        <div
          className={`venta-alert venta-alert--${mensaje.tipo}`}
        >
          <span>
            {mensaje.tipo === "success"
              ? "✓"
              : "!"}
          </span>

          {mensaje.texto}

          <button
            type="button"
            onClick={() =>
              setMensaje(null)
            }
          >
            ×
          </button>
        </div>
      )}

      <div className="venta-layout">
        {/* =========================================
            COLUMNA IZQUIERDA
        ========================================== */}

        <main className="venta-main">
          <section className="venta-panel">
            <button
              type="button"
              className="venta-collapse-header"
              onClick={() =>
                setDetalleExtraAbierto(
                  !detalleExtraAbierto
                )
              }
            >
              <span>
                <b>⊕</b>
                DETALLE EXTRA
              </span>

              <span>
                {detalleExtraAbierto
                  ? "−"
                  : "+"}
              </span>
            </button>

            {detalleExtraAbierto ? (
              <textarea
                className="venta-observacion"
                value={
                  venta.observacion
                }
                onChange={(e) =>
                  venta.setObservacion(
                    e.target.value
                  )
                }
                placeholder="Observación general de la venta..."
              />
            ) : (
              <div className="venta-none">
                Ninguno
              </div>
            )}
          </section>

          <section className="venta-panel">
            <ProductoSelector
              onAgregar={
                handleAgregarProducto
              }
            />

            <div className="venta-table-container">
              <VentaItemsTable
                lineas={venta.lineas}
                onCantidad={
                  venta.actualizarCantidad
                }
                onAlmacen={
                  venta.actualizarAlmacen
                }
                onPrecio={
                  venta.actualizarPrecio
                }
                onDescuento={
                  venta.actualizarDescuento
                }
                onInformacionExtra={
                  venta.actualizarInformacionExtra
                }
                onEliminar={
                  venta.eliminarLinea
                }
              />
            </div>

            <div className="venta-totales">
              <div>
                <span>SUB-TOTAL</span>

                <strong>
                  {money(
                    venta.totales
                      .subtotal
                  )}{" "}
                  BOB
                </strong>
              </div>

              <div>
                <span>
                  DESCUENTO PRODUCTOS
                </span>

                <strong>
                  {money(
                    venta.totales
                      .descuentoLineas
                  )}{" "}
                  BOB
                </strong>
              </div>

              <div>
                <span>
                  DESCUENTO ADICIONAL
                </span>

                <div className="venta-discount-input">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={
                      venta.descuentoAdicional
                    }
                    onChange={(e) =>
                      venta.setDescuentoAdicional(
                        Math.max(
                          0,
                          Number(
                            e.target
                              .value
                          )
                        )
                      )
                    }
                  />

                  <span>BOB</span>
                </div>
              </div>

              <div className="venta-totales__total">
                <span>
                  MONTO PAGAR
                </span>

                <strong>
                  {money(
                    venta.totales.total
                  )}{" "}
                  BOB
                </strong>
              </div>
            </div>
          </section>
        </main>

        {/* =========================================
            COLUMNA DERECHA
        ========================================== */}

        <aside className="venta-sidebar">
          <section className="venta-panel">
            <ClienteSelector
              cliente={venta.cliente}
              onSeleccionar={
                venta.setCliente
              }
              onNuevoCliente={() =>
                setModalClienteAbierto(
                  true
                )
              }
            />

            <div className="venta-field venta-email-alternativo">
              <label>
                Correo electrónico
                alternativo
              </label>

              <input
                placeholder="Correo alternativo"
              />
            </div>

            <label className="venta-check">
              <input type="checkbox" />

              <span>
                Permitir facturar incluso
                si el NIT es inválido
              </span>
            </label>
          </section>

          <PagoPanel
            total={
              venta.totales.total
            }
            bloqueado={
              venta.lineas.length === 0
            }
            procesando={procesando}
            onPagar={handlePagar}
          />
        </aside>
      </div>

      <NuevoClienteModal
        abierto={
          modalClienteAbierto
        }
        onCerrar={() =>
          setModalClienteAbierto(false)
        }
        onClienteCreado={
          handleClienteCreado
        }
      />

      {confirmarStockCero && pagoPendiente && (
        <div className="venta-stock-modal-backdrop" role="presentation">
          <section className="venta-stock-modal" role="dialog" aria-modal="true" aria-labelledby="venta-stock-title">
            <button type="button" className="venta-stock-modal__close" onClick={() => setConfirmarStockCero(false)} aria-label="Cerrar"><X size={20} /></button>
            <div className="venta-stock-modal__icon"><AlertTriangle size={28} /></div>
            <h2 id="venta-stock-title">Venta sin stock disponible</h2>
            <p>Uno o más productos tienen stock 0. Esta venta dejará el inventario en negativo y quedará pendiente de regularización.</p>
            <p className="venta-stock-modal__hint">Confirma que estás consciente de que estás vendiendo un producto que actualmente no existe en inventario.</p>
            <footer>
              <button type="button" className="venta-button venta-button--secondary" onClick={() => setConfirmarStockCero(false)}>Cancelar</button>
              <button type="button" className="venta-button venta-button--primary" onClick={() => { setConfirmarStockCero(false); void registrarPago(pagoPendiente); }}>Confirmar venta</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
