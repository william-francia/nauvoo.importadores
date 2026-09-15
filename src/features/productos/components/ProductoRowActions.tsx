import { useState } from "react";
import { Eye, List } from "lucide-react";

interface Props {
  onPreview: () => void;
  onEdit: () => void;
}

export default function ProductoRowActions({ onPreview, onEdit }: Props) {
  const [abierto, setAbierto] = useState(false);

  return (
    <div className="producto-row-actions">
      <button type="button" className="producto-action producto-action--menu" title="Más acciones" aria-label="Más acciones" onClick={() => setAbierto((actual) => !actual)}>
        <List size={16} aria-hidden="true" />
      </button>
      <button type="button" className="producto-action producto-action--eye" title="Ver producto" aria-label="Ver producto" onClick={onPreview}>
        <Eye size={16} aria-hidden="true" />
      </button>
      {abierto && (
        <div className="producto-row-menu">
          <button type="button" onClick={onEdit}>Editar producto</button>
        </div>
      )}
    </div>
  );
}
