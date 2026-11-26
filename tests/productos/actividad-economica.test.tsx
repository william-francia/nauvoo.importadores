import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ProductoForm from "../../src/features/productos/components/ProductoForm";
import type { ProductoFormValues } from "../../src/features/productos/types/productos.types";

const values: ProductoFormValues = { actividadEconomicaCodigo: "4752100", homologadoCodigo: "", nombre: "", descripcion: "", unidadMedida: "", precio: 0, precioComparacion: 0, costo: 0, sku: "", codigoBarras: "", tipoProducto: "", proveedor: "", tieneOpciones: false };
describe("actividad económica de productos nuevos", () => {
  it("muestra la actividad completa y bloqueada sin elegir un producto SIN", () => {
    const html = renderToStaticMarkup(<ProductoForm mode="create" initialValues={values} onSubmit={vi.fn()} onCancelar={vi.fn()} />);
    expect(html.indexOf("HOMOLOGACIÓN")).toBeLessThan(html.indexOf("INFORMACIÓN DEL PRODUCTO"));
    expect(html).toContain("P - 4752100 - Venta al por menor de artículos de ferretería, fontanería y calefacción");
    expect(html).toMatch(/<textarea[^>]*readonly/i);
    expect(html).not.toContain("62161");
  });
  it("al editar muestra lo persistido y no atribuye actividad a un producto legado", () => {
    const historical = renderToStaticMarkup(<ProductoForm mode="edit" initialValues={{ ...values, actividadEconomicaCodigo: "" }} onSubmit={vi.fn()} onCancelar={vi.fn()} />);
    expect(historical).toContain("Sin actividad económica registrada");
    expect(historical).toMatch(/<textarea[^>]*readonly/i);
  });
});
