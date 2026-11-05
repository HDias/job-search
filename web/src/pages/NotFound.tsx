import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="state state-empty">
      <strong>Página não encontrada</strong>
      <p>O endereço acessado não existe neste app.</p>
      <Link className="button" to="/">
        Ir para o dashboard
      </Link>
    </div>
  );
}
