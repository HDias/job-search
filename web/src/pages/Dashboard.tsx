import { useDeferredValue, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useJobs, useStats } from '../api/hooks';
import { JOB_STATUSES, type JobStatus } from '../api/types';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '../components/StateMessage';
import { STATUS_LABELS, fitTone, formatDate, formatFit } from '../lib/format';

const PAGE_SIZE = 25;

function parseStatus(value: string | null): JobStatus | '' {
  return JOB_STATUSES.includes(value as JobStatus) ? (value as JobStatus) : '';
}

function parsePage(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const status = parseStatus(searchParams.get('status'));
  const page = parsePage(searchParams.get('page'));
  const offset = (page - 1) * PAGE_SIZE;

  const [queryInput, setQueryInput] = useState(query);
  const deferredQuery = useDeferredValue(queryInput.trim());

  // Mantém o input em sincronia com voltar/avançar do navegador.
  useEffect(() => {
    setQueryInput(query);
  }, [query]);

  // Reflete a busca na URL sem empilhar histórico a cada tecla.
  useEffect(() => {
    if (deferredQuery === query) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (deferredQuery) next.set('q', deferredQuery);
        else next.delete('q');
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  }, [deferredQuery, query, setSearchParams]);

  const stats = useStats();
  const jobs = useJobs({
    q: deferredQuery || undefined,
    status: status || undefined,
    limit: PAGE_SIZE,
    offset: offset || undefined,
  });

  const hasFilters = queryInput.trim().length > 0 || status !== '';
  const total = jobs.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function updateParams(patch: Record<string, string | null>, resetPage = true) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      }
      if (resetPage) next.delete('page');
      return next;
    });
  }

  function clearFilters() {
    setQueryInput('');
    setSearchParams({});
  }

  function goToPage(nextPage: number) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextPage <= 1) next.delete('page');
      else next.set('page', String(nextPage));
      return next;
    });
  }

  const average = stats.data?.averageFitRating;

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Visão geral</p>
          <h1>Dashboard</h1>
          <p className="muted">
            Acompanhe candidaturas, fits e os artefatos gerados pelo pipeline.
          </p>
        </div>
      </div>

      <section className="stats-grid" aria-label="Estatísticas">
        <StatCard
          label="Vagas"
          value={stats.data?.total ?? '—'}
          hint={`${stats.data?.appliedLast30Days ?? 0} aplicadas nos últimos 30 dias`}
          tone="accent"
        />
        <StatCard
          label="Aplicadas"
          value={stats.data?.byStatus.applied ?? 0}
          hint="aguardando retorno"
        />
        <StatCard
          label="Entrevistas"
          value={stats.data?.byStatus.interview ?? 0}
          hint={`${stats.data?.byStatus.offer ?? 0} proposta(s)`}
          tone="good"
        />
        <StatCard
          label="Fit médio"
          value={formatFit(average)}
          hint="somente vagas com análise"
          tone={fitTone(average) === 'high' ? 'good' : 'warn'}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Vagas</h2>
          <span className="muted">
            {jobs.data ? `${jobs.data.total} resultado(s)` : 'carregando…'}
          </span>
        </div>

        <div className="filters">
          <label className="field grow">
            <span>Buscar</span>
            <input
              type="search"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder="Empresa, cargo ou análise"
            />
          </label>

          <label className="field">
            <span>Status</span>
            <select
              value={status}
              onChange={(event) => updateParams({ status: event.target.value })}
            >
              <option value="">Todos</option>
              {JOB_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </label>

          {hasFilters ? (
            <button type="button" className="button ghost" onClick={clearFilters}>
              Limpar
            </button>
          ) : null}
        </div>

        {jobs.isLoading ? <LoadingState label="Carregando vagas…" /> : null}

        {jobs.isError ? (
          <ErrorState
            message={jobs.error instanceof Error ? jobs.error.message : 'Erro desconhecido'}
            onRetry={() => void jobs.refetch()}
          />
        ) : null}

        {jobs.data && jobs.data.items.length === 0 ? (
          <EmptyState
            title="Nenhuma vaga encontrada"
            description={
              hasFilters
                ? 'Ajuste a busca ou o filtro de status.'
                : 'Importe os dados do v1 ou cadastre a primeira vaga.'
            }
            action={
              hasFilters ? (
                <button type="button" className="button" onClick={clearFilters}>
                  Limpar filtros
                </button>
              ) : null
            }
          />
        ) : null}

        {jobs.data && jobs.data.items.length > 0 ? (
          <div className="table-wrap">
            <table className="jobs-table">
              <thead>
                <tr>
                  <th scope="col">Empresa</th>
                  <th scope="col">Cargo</th>
                  <th scope="col">Status</th>
                  <th scope="col">Fit</th>
                  <th scope="col">Aplicada em</th>
                  <th scope="col">Canal</th>
                </tr>
              </thead>
              <tbody>
                {jobs.data.items.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <Link className="table-link strong" to={`/jobs/${job.id}`}>
                        {job.company}
                      </Link>
                    </td>
                    <td>
                      <Link className="table-link" to={`/jobs/${job.id}`}>
                        {job.role}
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={job.status} />
                    </td>
                    <td>
                      <span className={`fit-pill tone-${fitTone(job.fit?.rating)}`}>
                        {formatFit(job.fit?.rating)}
                      </span>
                    </td>
                    <td className="nowrap">{formatDate(job.appliedAt ?? job.createdAt)}</td>
                    <td className="nowrap muted">{job.channel ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {jobs.data && jobs.data.items.length > 0 && totalPages > 1 ? (
          <nav className="pagination" aria-label="Paginação">
            <button
              type="button"
              className="button ghost"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
            >
              ← Anterior
            </button>
            <span className="muted">
              Página {page} de {totalPages}
            </span>
            <button
              type="button"
              className="button ghost"
              disabled={page >= totalPages}
              onClick={() => goToPage(page + 1)}
            >
              Próxima →
            </button>
          </nav>
        ) : null}
      </section>
    </div>
  );
}
