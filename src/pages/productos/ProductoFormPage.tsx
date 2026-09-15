// src/pages/productos/ProductoFormPage.tsx

import {
  useMemo,
  useState,
} from "react";

import {
  useNavigate,
  useParams,
} from "react-router";

import "../../features/productos/styles/productos.css";

import ProductoForm from "../../features/productos/components/ProductoForm";

import {
  PRODUCTOS_MOCK,
} from "../../features/productos/data/productos.mock";

import type {
  ProductoFormValues,
} from "../../features/productos/types/productos.types";

const INITIAL_VALUES: ProductoFormValues = {
  actividadEconomicaCodigo:
    "475200",

  homologadoCodigo:
    "62161",

  nombre: "",

  descripcion: "",

  unidadMedida: "",

  precio: 0,

  precioComparacion: 0,

  costo: 0,

  sku: "",

  codigoBarras: "",

  tipoProducto: "",

  proveedor: "",

  tieneOpciones: false,
};

export default function ProductoFormPage() {
  const navigate =
    useNavigate();

  const {
    productoId,
  } = useParams();

  const [guardando, setGuardando] =
    useState(false);

  const producto =
    useMemo(
      () =>
        PRODUCTOS_MOCK.find(
          (item) =>
            item.id === productoId
        ) ?? null,
      [productoId]
    );

  const mode =
    productoId
      ? "edit"
      : "create";

  if (
    mode === "edit" &&
    !producto
  ) {
    return (
      <div className="productos-page">
        <div className="producto-not-found">
          <h2>
            Producto no encontrado
          </h2>

          <button
            type="button"
            className="productos-btn productos-btn--primary"
            onClick={() =>
              navigate(
                "/productos/gestion"
              )
            }
          >
            Volver
          </button>
        </div>
      </div>
    );
  }

  const initialValues:
    ProductoFormValues =
    producto
      ? {
          actividadEconomicaCodigo:
            producto.actividadEconomicaCodigo,

          homologadoCodigo:
            producto.homologadoCodigo,

          nombre:
            producto.nombre,

          descripcion:
            producto.descripcion,

          unidadMedida:
            producto.unidadMedida,

          precio:
            producto.precio,

          precioComparacion:
            producto.precioComparacion,

          costo:
            producto.costo,

          sku:
            producto.sku,

          codigoBarras:
            producto.codigoBarras,

          tipoProducto:
            producto.tipoProducto ??
            "",

          proveedor:
            producto.proveedor ??
            "",

          tieneOpciones:
            producto.tieneOpciones,
        }
      : INITIAL_VALUES;

  async function guardar(
    values: ProductoFormValues
  ) {
    try {
      setGuardando(true);

      /*
       * IMPORTANTE:
       *
       * Aquí conectaremos el servicio
       * real de Supabase.
       *
       * Crear:
       *
       * await crearProducto(values)
       *
       * Editar:
       *
       * await actualizarProducto(
       *   productoId,
       *   values
       * )
       *
       * No inventamos nombres SQL
       * hasta revisar el esquema real.
       */

      console.log(
        mode === "create"
          ? "Nuevo producto:"
          : "Editar producto:",

        values
      );

      navigate(
        "/productos/gestion"
      );
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="productos-page">
      <header className="producto-form-page-header">
        <div>
          <div className="productos-breadcrumb">
            Productos
            <span>›</span>
            Gestión de productos
            <span>›</span>
            {mode === "create"
              ? "Nuevo producto"
              : "Editar producto"}
          </div>

          <h1>
            {mode === "create"
              ? "Nuevo Producto"
              : "Editar Producto"}
          </h1>
        </div>
      </header>

      <ProductoForm
        key={
          producto?.id ??
          "nuevo"
        }
        mode={mode}
        initialValues={
          initialValues
        }
        stockActual={
          producto?.stockPorLocal
        }
        guardando={
          guardando
        }
        onSubmit={
          guardar
        }
        onCancelar={() =>
          navigate(
            "/productos/gestion"
          )
        }
      />
    </div>
  );
}
