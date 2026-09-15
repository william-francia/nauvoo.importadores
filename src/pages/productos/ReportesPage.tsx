import {
  useMemo,
  useState,
} from "react";

import {
  BarChart3,
  Box,
  Calculator,
  CircleDollarSign,
} from "lucide-react";

import "../../features/productos/reportes/styles/reportes.css";

import ReporteCard from "../../features/productos/reportes/components/ReporteCard";
import FaltanDatosModal from "../../features/productos/reportes/components/FaltanDatosModal";
import DatosMensualesModal from "../../features/productos/reportes/components/DatosMensualesModal";

import {
  descargarReporte,
} from "../../features/productos/reportes/services/reportes.service";

import {
  calcularEstadoResultados,
  calcularFlujoCaja,
  calcularVentasFacturacion,
} from "../../features/productos/reportes/services/reportes.calculations";

import type {
  DatosMensualesComplementarios,
  ReporteFormato,
  ReporteIssue,
  ReporteTipo,
  ReportesSnapshot,
} from "../../features/productos/reportes/types/reportes.types";

/*
 * TEMPORAL.
 *
 * Sustituye esta importación cuando
 * conectemos el repositorio a Supabase.
 */
import {
  REPORTES_DEMO,
} from "../../features/productos/reportes/data/reportes.demo";

function currentMonth() {
  const date = new Date();

  return `${date.getFullYear()}-${String(
    date.getMonth() + 1
  ).padStart(2, "0")}`;
}

const DATOS_MENSUALES_VACIOS:
  DatosMensualesComplementarios =
  {
    ivaCreditoFiscal: null,

    itDeclaradoOEstimado: null,

    iueEstimado: null,

    otrosIngresos: 0,

    otrosGastos: 0,

    gastosOperativosAdicionales:
      0,

    gastosFinancierosAdicionales:
      0,

    saldoInicialCaja: null,

    saldoInicialBancos: null,
  };

export default function ReportesPage() {
  const [
    periodo,
    setPeriodo,
  ] = useState(
    currentMonth()
  );

  const [
    snapshot,
    setSnapshot,
  ] =
    useState<ReportesSnapshot>(
      REPORTES_DEMO
    );

  const [
    issues,
    setIssues,
  ] = useState<
    ReporteIssue[]
  >([]);

  const [
    modalIssues,
    setModalIssues,
  ] = useState(false);

  const [
    modalDatos,
    setModalDatos,
  ] = useState(false);

  const estadoResultados =
    useMemo(
      () =>
        calcularEstadoResultados(
          snapshot,
          {
            mes: periodo,
          }
        ),
      [
        snapshot,
        periodo,
      ]
    );

  const ventas =
    useMemo(
      () =>
        calcularVentasFacturacion(
          snapshot,
          {
            mes: periodo,
          }
        ),
      [
        snapshot,
        periodo,
      ]
    );

  const flujo =
    useMemo(
      () =>
        calcularFlujoCaja(
          snapshot,
          {
            mes: periodo,
          }
        ),
      [
        snapshot,
        periodo,
      ]
    );

  async function handleDownload(
    tipo: ReporteTipo,
    formato: ReporteFormato
  ) {
    const result =
      await descargarReporte({
        tipo,

        formato,

        periodo: {
          mes: periodo,
        },

        snapshot,
      });

    if (!result.ok) {
      setIssues(
        result.issues ?? []
      );

      setModalIssues(true);
    }
  }

  function guardarDatosMensuales(
    values:
      DatosMensualesComplementarios
  ) {
    setSnapshot(
      (current) => ({
        ...current,

        datosMensuales: {
          ...current.datosMensuales,

          [periodo]:
            values,
        },
      })
    );

    setModalDatos(false);

    setModalIssues(false);
  }

  const datosMensuales =
    snapshot.datosMensuales[
      periodo
    ] ??
    DATOS_MENSUALES_VACIOS;

  return (
    <div className="reportes-page">
      <header className="reportes-page__header">
        <div>
          <div className="reportes-breadcrumb">
            Productos
            <span>›</span>
            Reportes
          </div>

          <h1>
            Reportes de productos y ventas
          </h1>

          <p>
            Descarga y analiza la información
            clave de tu ferretería.
          </p>
        </div>

        <label className="report-period">
          <span>
            Período
          </span>

          <input
            type="month"
            value={periodo}
            onChange={(event) =>
              setPeriodo(
                event.target.value
              )
            }
          />
        </label>
      </header>

      <section className="reports-grid">
        <ReporteCard
          icon={
            <BarChart3 />
          }
          titulo="Estado de Resultados"
          subtitulo="Pérdidas y Ganancias"
          descripcion="Conoce si el negocio está generando ganancias netas al final del período."
          onPdf={() =>
            handleDownload(
              "ESTADO_RESULTADOS",
              "PDF"
            )
          }
          onExcel={() =>
            handleDownload(
              "ESTADO_RESULTADOS",
              "EXCEL"
            )
          }
        >
          <div className="result-preview">
            <div>
              <span>
                Ventas netas
              </span>

              <strong>
                Bs.{" "}
                {estadoResultados.ventasNetas.toFixed(
                  2
                )}
              </strong>
            </div>

            <div>
              <span>
                Costo ventas
              </span>

              <strong>
                Bs.{" "}
                {estadoResultados.costoVentas.toFixed(
                  2
                )}
              </strong>
            </div>

            <div>
              <span>
                Gastos
              </span>

              <strong>
                Bs.{" "}
                {estadoResultados.gastosOperativos.toFixed(
                  2
                )}
              </strong>
            </div>

            <div className="result-preview__net">
              <span>
                Ganancia neta
              </span>

              <strong>
                Bs.{" "}
                {estadoResultados.utilidadNeta.toFixed(
                  2
                )}
              </strong>
            </div>
          </div>
        </ReporteCard>

        <ReporteCard
          icon={
            <Calculator />
          }
          titulo="Reporte de Ventas y Facturación"
          subtitulo="Ventas y SIN"
          descripcion="Revisa ventas, facturación, métodos de pago e información fiscal."
          onPdf={() =>
            handleDownload(
              "VENTAS_FACTURACION",
              "PDF"
            )
          }
          onExcel={() =>
            handleDownload(
              "VENTAS_FACTURACION",
              "EXCEL"
            )
          }
        >
          <div className="mini-bars">
            <span
              style={{
                height: "38%",
              }}
            />

            <span
              style={{
                height: "52%",
              }}
            />

            <span
              style={{
                height: "75%",
              }}
            />

            <span
              style={{
                height: "95%",
              }}
            />

            <span
              style={{
                height: "65%",
              }}
            />

            <span
              style={{
                height: "82%",
              }}
            />
          </div>

          <small className="report-preview-footer">
            Total: Bs.{" "}
            {ventas.totalFacturado.toFixed(
              2
            )}
          </small>
        </ReporteCard>

        <ReporteCard
          icon={
            <CircleDollarSign />
          }
          titulo="Flujo de Caja"
          subtitulo="Efectivo Diario"
          descripcion="Controla cuánto dinero real entra y sale de caja y bancos."
          onPdf={() =>
            handleDownload(
              "FLUJO_CAJA",
              "PDF"
            )
          }
          onExcel={() =>
            handleDownload(
              "FLUJO_CAJA",
              "EXCEL"
            )
          }
        >
          <div className="cash-preview">
            <div>
              <span>
                Ingresos
              </span>

              <strong className="positive">
                + Bs.{" "}
                {flujo.ingresosTotales.toFixed(
                  2
                )}
              </strong>
            </div>

            <div>
              <span>
                Egresos
              </span>

              <strong className="negative">
                - Bs.{" "}
                {flujo.egresosTotales.toFixed(
                  2
                )}
              </strong>
            </div>

            <div>
              <span>
                Saldo final
              </span>

              <strong>
                Bs.{" "}
                {flujo.saldoFinalTotal.toFixed(
                  2
                )}
              </strong>
            </div>
          </div>
        </ReporteCard>

        <ReporteCard
          icon={
            <Box />
          }
          titulo="Ventas por Producto"
          subtitulo="Kárdex de Inventario"
          descripcion="Consulta entradas, salidas, existencia física y valor monetario por producto."
          onPdf={() =>
            handleDownload(
              "VENTAS_PRODUCTO",
              "PDF"
            )
          }
          onExcel={() =>
            handleDownload(
              "VENTAS_PRODUCTO",
              "EXCEL"
            )
          }
        >
          <div className="ranking-preview">
            {ventas.rankingProductos
              .slice(0, 4)
              .map(
                (
                  producto,
                  index
                ) => (
                  <div
                    key={
                      producto.codigo
                    }
                  >
                    <span>
                      {
                        producto.nombre
                      }
                    </span>

                    <div>
                      <i
                        style={{
                          width: `${Math.max(
                            20,
                            100 -
                              index *
                                20
                          )}%`,
                        }}
                      />

                      <strong>
                        {
                          producto.cantidad
                        }
                      </strong>
                    </div>
                  </div>
                )
              )}
          </div>
        </ReporteCard>
      </section>

      <section className="reports-bottom">
        <div className="reports-info">
          <h2>
            Datos del período
          </h2>

          <p>
            Los reportes se generan únicamente con
            información correspondiente a{" "}
            <strong>
              {periodo}
            </strong>
            .
          </p>

          <button
            type="button"
            className="reports-btn reports-btn--outline"
            onClick={() =>
              setModalDatos(
                true
              )
            }
          >
            Editar datos complementarios
          </button>
        </div>

        <div className="reports-tip">
          <strong>
            Consejo
          </strong>

          <p>
            Mantén costos, gastos, saldos iniciales
            y datos fiscales completos. Los
            reportes son tan confiables como la
            información registrada.
          </p>
        </div>
      </section>

      <FaltanDatosModal
        abierto={
          modalIssues
        }
        issues={issues}
        onCerrar={() =>
          setModalIssues(false)
        }
        onIngresarDatos={() => {
          setModalIssues(false);

          setModalDatos(true);
        }}
      />

      {modalDatos && (
        <DatosMensualesModal
          mes={periodo}
          valores={
            datosMensuales
          }
          onCerrar={() =>
            setModalDatos(false)
          }
          onGuardar={
            guardarDatosMensuales
          }
        />
      )}
    </div>
  );
}
