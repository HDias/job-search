import { NavLink, Outlet } from 'react-router-dom';

export function Layout() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">
            <span className="brand-mark">JS</span>
            <span>
              Job Search <span className="brand-version">v2</span>
            </span>
          </NavLink>

          <nav className="nav" aria-label="Navegação principal">
            <NavLink
              to="/"
              end
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              Dashboard
            </NavLink>
            <a className="nav-link" href="/api/health" target="_blank" rel="noreferrer">
              API
            </a>
          </nav>
        </div>
      </header>

      <main className="container">
        <Outlet />
      </main>

      <footer className="footer">
        Dados locais em SQLite · API na porta 3344 · v1 intacto na 3333
      </footer>
    </div>
  );
}
