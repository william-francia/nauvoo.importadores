import type {
  ReactNode,
} from "react";

import {
  Download,
  FileSpreadsheet,
  FileText,
} from "lucide-react";

interface Props {
  icon: ReactNode;

  titulo: string;

  subtitulo: string;

  descripcion: string;

  children?: ReactNode;

  onPdf: () => void;

  onExcel: () => void;
}

export default function ReporteCard({
  icon,

  titulo,

  subtitulo,

  descripcion,

  children,

  onPdf,

  onExcel,
}: Props) {
  return (
    <article className="report-card">
      <header className="report-card__header">
        <div className="report-card__icon">
          {icon}
        </div>

        <div>
          <h2>
            {titulo}
          </h2>

          <span>
            {subtitulo}
          </span>
        </div>
      </header>

      <p className="report-card__description">
        {descripcion}
      </p>

      <div className="report-card__preview">
        {children}
      </div>

      <div className="report-card__buttons">
        <button
          type="button"
          className="report-download report-download--pdf"
          onClick={onPdf}
        >
          <FileText
            size={16}
          />

          PDF

          <Download
            size={14}
          />
        </button>

        <button
          type="button"
          className="report-download report-download--excel"
          onClick={onExcel}
        >
          <FileSpreadsheet
            size={16}
          />

          Excel

          <Download
            size={14}
          />
        </button>
      </div>
    </article>
  );
}