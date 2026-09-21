// src/pages/productos/ProductoFormPage.tsx

import {
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";

import {
  useNavigate,
  useParams,
} from "react-router";

import "../../features/productos/styles/productos.css";

import ProductoForm from "../../features/productos/components/ProductoForm";

import type {
  ProductoFormValues,
} from "../../features/productos/types/productos.types";
import ProductoHomologacionModal from "../../features/productos/components/ProductoHomologacionModal";
import { listarHomologacionesProductos } from "../../features/facturas/services/siat.service";
import type { ProductoHomologacion } from "../../features/facturas/types/siat.types";
import { EstadoBadge } from "../../features/facturas/components/SiatShared";
import "../../features/facturas/styles/siat.css";
import { useActualizarProducto, useCrearProducto, useProductos } from "../../features/productos/hooks/useProductos";

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

  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);
  const productosQuery = useProductos();
  const crearMutation = useCrearProducto();
  const actualizarMutation = useActualizarProducto();
  const [homologacionAbierta,setHomologacionAbierta]=useState(false);
  const homologaciones=useQuery({queryKey:["siat-productos-homologacion"],queryFn:listarHomologacionesProductos});

  const producto = productosQuery.data?.find((item) => item.id === productoId) ?? null;

  const mode =
    productoId
      ? "edit"
      : "create";
  const homologacion:ProductoHomologacion|null=producto ? (homologaciones.data?.find(item=>item.productoId===producto.id||item.codigoInterno.toUpperCase()===producto.sku.toUpperCase())??null) : null;

  if (mode === "edit" && productosQuery.isLoading) {
    return <div className="productos-page"><div className="producto-not-found"><h2>Cargando producto…</h2></div></div>;
  }

  if (productosQuery.error) {
    return <div className="productos-page"><div className="producto-not-found"><h2>No se pudo cargar el producto</h2><p>{productosQuery.error.message}</p></div></div>;
  }

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
      setErrorGuardado(null);
      if (mode === "create") {
        await crearMutation.mutateAsync(values);
      } else if (productoId) {
        await actualizarMutation.mutateAsync({ id: productoId, values });
      }
      navigate("/productos/gestion", { state: { productoGuardado: mode === "create" ? "Producto creado correctamente." : "Producto actualizado correctamente." } });
    } catch (cause) {
      setErrorGuardado(cause instanceof Error ? cause.message : "No se pudo guardar el producto.");
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
          crearMutation.isPending || actualizarMutation.isPending
        }
        errorExterno={errorGuardado}
        onSubmit={
          guardar
        }
        onCancelar={() =>
          navigate(
            "/productos/gestion"
          )
        }
      />
      <section className="siat-card" style={{marginTop:16}}><div className="siat-card-title"><div><h3>Datos fiscales SIAT</h3><p>La homologación usa únicamente catálogos oficiales sincronizados.</p></div>{homologacion?<EstadoBadge estado={homologacion.estado}/>:<EstadoBadge estado="PENDIENTE"/>}</div>{mode==="create"?<p className="siat-muted">Guarda primero el producto para asociar su homologación fiscal.</p>:homologacion?<button type="button" className="siat-secondary-button" onClick={()=>setHomologacionAbierta(true)}>Administrar homologación</button>:<p className="siat-muted">Este producto de la vista actual aún no coincide con un registro real de Supabase.</p>}</section>
      {homologacionAbierta&&<ProductoHomologacionModal producto={homologacion} onClose={()=>setHomologacionAbierta(false)}/>}
    </div>
  );
}
