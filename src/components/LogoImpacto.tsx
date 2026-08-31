import "./LogoImpacto.css";
import logo from "../assets/logo.png";

export default function LogoImpacto() {
  return (
    <div className="impact-scene">

      {/* POLVO DETRÁS */}
      <div className="dust">
        <span className="dust-1"></span>
        <span className="dust-2"></span>
        <span className="dust-3"></span>
        <span className="dust-4"></span>
        <span className="dust-5"></span>
        <span className="dust-6"></span>
        <span className="dust-7"></span>
        <span className="dust-8"></span>
      </div>

      {/* LOGO */}
      <img
        src={logo}
        alt="Ferretería Francia"
        className="impact-logo"
      />

      {/* SOMBRA DEL IMPACTO */}
      <div className="impact-shadow"></div>

    </div>
  );
}