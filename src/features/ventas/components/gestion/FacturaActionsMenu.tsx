import {
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  FacturaAction,
  GestionVenta,
} from "../../types/gestionVentas.types";

interface Props {
  venta: GestionVenta;

  onAction: (
    action: FacturaAction,
    venta: GestionVenta
  ) => void;
}

interface ActionItem {
  action: FacturaAction;

  label: string;

  icon: string;

  danger?: boolean;
}

const ACTIONS: ActionItem[] = [
  {
    action: "SIN",
    label: "Datos del S.I.N.",
    icon: "◎",
  },

  {
    action: "ANULAR",
    label: "Anular factura",
    icon: "⊘",
    danger: true,
  },

  {
    action: "PDF_MEDIO_OFICIO",
    label: "PDF Medio Oficio",
    icon: "PDF",
  },

  {
    action: "PDF_ROLLO",
    label: "PDF Rollo",
    icon: "▤",
  },

  {
    action: "XML",
    label: "XML",
    icon: "</>",
  },

  {
    action: "URL_SIN",
    label: "URL S.I.N.",
    icon: "↗",
  },

  {
    action: "REENVIAR_CORREO",
    label: "Reenviar correo",
    icon: "✉",
  },
];

export default function FacturaActionsMenu({
  venta,
  onAction,
}: Props) {
  const [abierto, setAbierto] =
    useState(false);

  const ref =
    useRef<HTMLDivElement>(null);

  useEffect(() => {
    function clickFuera(
      event: MouseEvent
    ) {
      if (
        ref.current &&
        !ref.current.contains(
          event.target as Node
        )
      ) {
        setAbierto(false);
      }
    }

    document.addEventListener(
      "mousedown",
      clickFuera
    );

    return () =>
      document.removeEventListener(
        "mousedown",
        clickFuera
      );
  }, []);

  function seleccionar(
    action: FacturaAction
  ) {
    setAbierto(false);

    onAction(action, venta);
  }

  return (
    <div
      className="gestion-actions"
      ref={ref}
    >
      <button
        type="button"
        className="gestion-actions__trigger"
        onClick={() =>
          setAbierto(
            (actual) => !actual
          )
        }
        aria-label={`Acciones de la factura ${venta.numeroFactura}`}
        aria-expanded={abierto}
      >
        ⋮
      </button>

      {abierto && (
        <div className="gestion-actions__menu">
          <div className="gestion-actions__title">
            Factura #
            {venta.numeroFactura}
          </div>

          {ACTIONS.map((item) => (
            <button
              type="button"
              key={item.action}
              className={
                item.danger
                  ? "gestion-actions__item gestion-actions__item--danger"
                  : "gestion-actions__item"
              }
              onClick={() =>
                seleccionar(
                  item.action
                )
              }
            >
              <span className="gestion-actions__icon">
                {item.icon}
              </span>

              <span>
                {item.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}