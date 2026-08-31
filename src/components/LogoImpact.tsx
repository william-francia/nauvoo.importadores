import logo from '../assets/logo.png'

export function LogoImpact() {
  return (
    <div className="logo-impact">
      <div className="speed-lines" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="impact-dust" aria-hidden="true">
        <span className="dust-particle dust-particle--1" />
        <span className="dust-particle dust-particle--2" />
        <span className="dust-particle dust-particle--3" />
        <span className="dust-particle dust-particle--4" />
        <span className="dust-particle dust-particle--5" />
        <span className="dust-particle dust-particle--6" />
        <span className="dust-particle dust-particle--7" />
        <span className="dust-particle dust-particle--8" />
        <span className="dust-particle dust-particle--9" />
        <span className="dust-particle dust-particle--10" />
        <span className="dust-particle dust-particle--11" />
        <span className="dust-particle dust-particle--12" />
      </div>
      <img className="impact-logo" src={logo} alt="Nauvoo Importadores" />
      <div className="impact-ring" aria-hidden="true" />
      <div className="impact-shadow" aria-hidden="true" />
    </div>
  )
}
