import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import type { Artifact } from '../../domain/artifact.js';
import type { Store } from '../../repositories/types.js';
import { HttpError } from '../http.js';

const VIEW_LABEL: Record<string, string> = {
  email: '📧 E-mail de candidatura',
  recruiter: '💬 Resposta ao recrutador',
  suggestions: '❓ Como responder',
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeResolve(baseDir: string, relativePath: string): string | null {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, relativePath);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return fs.existsSync(target) ? target : null;
}

function pickArtifact(
  artifacts: Artifact[],
  kinds: string[],
): Artifact | undefined {
  for (const kind of kinds) {
    const found = artifacts.find((artifact) => artifact.kind === kind);
    if (found) return found;
  }
  return undefined;
}

function pageShell(title: string, subtitle: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; background: #0f172a; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    header { position: sticky; top: 0; background: rgba(15,23,42,.97); border-bottom: 2px solid #38bdf8; padding: 12px 20px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    header strong { color: #38bdf8; }
    header a, header button { background: #0284c7; color: #fff; text-decoration: none; border: 0; border-radius: 6px; padding: 7px 14px; font-weight: 600; font-size: .85rem; cursor: pointer; }
    main { max-width: 920px; margin: 24px auto; padding: 0 18px 60px; }
    pre { white-space: pre-wrap; word-break: break-word; background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 18px; line-height: 1.55; font-size: .92rem; }
    .meta { color: #94a3b8; font-size: .9rem; }
    .empty { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 22px; }
  </style>
</head>
<body>
  <header>
    <strong>${escapeHtml(title)}</strong>
    <span class="meta">${escapeHtml(subtitle)}</span>
    <button onclick="window.print()">🖨️ Imprimir</button>
  </header>
  <main>${body}</main>
</body>
</html>`;
}

export function createViewersRouter(
  store: Store,
  applicationsDir: string,
): Router {
  const router = Router();

  router.get('/cv/:id', (req, res) => {
    const job = store.jobs.get(req.params.id);
    if (!job) throw new HttpError(404, 'Currículo não encontrado');

    const artifacts = store.artifacts.listByJob(job.id);
    let artifact = pickArtifact(artifacts, ['cv_html']);
    let file = artifact
      ? safeResolve(applicationsDir, artifact.relativePath)
      : null;

    if (!file) {
      const pdf = pickArtifact(artifacts, ['cv_pdf']);
      if (pdf) {
        const htmlCandidate = pdf.relativePath.replace(/\.pdf$/i, '.html');
        file = safeResolve(applicationsDir, htmlCandidate);
        if (file) artifact = { ...pdf, relativePath: htmlCandidate };
      }
    }

    if (!file) {
      res
        .status(404)
        .type('html')
        .send(
          pageShell(
            'Currículo não encontrado',
            `${job.company} — ${job.role}`,
            '<div class="empty">O arquivo HTML do currículo não está disponível. O PDF pode continuar acessível no painel.</div>',
          ),
        );
      return;
    }

    const pdf = pickArtifact(artifacts, ['cv_pdf']);
    const fitBadge = job.fit?.rating
      ? `<span class="meta">✓ ${job.fit.rating}% fit</span>`
      : '';

    const bar = `<div style="position:sticky;top:0;z-index:9999;background:rgba(15,23,42,.97);color:#f8fafc;padding:10px 20px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;border-bottom:2px solid #38bdf8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <strong style="color:#38bdf8;">${escapeHtml(job.company)}</strong>
        <span style="color:#94a3b8;">— ${escapeHtml(job.role)}</span>
        ${fitBadge}
      </div>
      <div style="display:flex;gap:10px;align-items:center;">
        ${pdf ? `<a href="/applications/${escapeHtml(pdf.relativePath)}" target="_blank" download style="background:#0284c7;color:#fff;text-decoration:none;padding:7px 14px;border-radius:6px;font-weight:600;font-size:.85rem;">📥 Baixar PDF</a>` : ''}
        <button onclick="window.print()" style="background:#334155;color:#f8fafc;border:1px solid #475569;padding:7px 14px;border-radius:6px;font-weight:600;font-size:.85rem;cursor:pointer;">🖨️ Imprimir</button>
      </div>
    </div>`;

    let html = fs.readFileSync(file, 'utf8');
    html = /<body[^>]*>/i.test(html)
      ? html.replace(/<body([^>]*)>/i, `<body$1>${bar}`)
      : bar + html;

    res.type('html').send(html);
  });

  router.get('/extras/:id/:view', (req, res) => {
    const { id, view } = req.params;
    const label = VIEW_LABEL[view];
    if (!label) throw new HttpError(404, 'Visão desconhecida');

    const job = store.jobs.get(id);
    if (!job) throw new HttpError(404, 'Candidatura não encontrada');

    const artifacts = store.artifacts.listByJob(job.id);
    const artifact =
      view === 'email'
        ? pickArtifact(artifacts, ['email_text'])
        : view === 'recruiter'
          ? pickArtifact(artifacts, ['recruiter_note', 'linkedin_note'])
          : pickArtifact(artifacts, ['suggestions', 'questions']);

    if (!artifact) {
      res.type('html').send(
        pageShell(
          label,
          `${job.company} — ${job.role}`,
          '<div class="empty">Nenhum material registrado para esta vaga.</div>',
        ),
      );
      return;
    }

    const file = safeResolve(applicationsDir, artifact.relativePath);
    if (!file) {
      res.type('html').send(
        pageShell(
          label,
          `${job.company} — ${job.role}`,
          '<div class="empty">O arquivo existe no banco, mas não foi encontrado no disco.</div>',
        ),
      );
      return;
    }

    const raw = fs.readFileSync(file, 'utf8');
    let content = raw;
    if (path.extname(file).toLowerCase() === '.json') {
      try {
        content = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        content = raw;
      }
    }

    const download = `/applications/${artifact.relativePath}`;
    const body = `<pre>${escapeHtml(content)}</pre>
      <p><a href="${escapeHtml(download)}" target="_blank">Abrir arquivo original</a></p>`;

    res.type('html').send(
      pageShell(label, `${job.company} — ${job.role}`, body),
    );
  });

  return router;
}
