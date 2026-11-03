# ADR-0006 — Artefatos no filesystem

- **Status:** Aceita
- **Data:** 2026-11-02

## Contexto

Cada candidatura gera vários arquivos: currículo em HTML e PDF, carta, e-mail, mensagem para
recrutador, sugestões de resposta, JSON de perguntas. São binários ou documentos grandes, que o
pipeline do v1 já grava em `applications/<slug>/`.

Guardar tudo em BLOB no SQLite simplificaria backup e transações, mas inflaria o banco, pioraria a
performance de leitura e dificultaria servir via HTTP.

## Decisão

- **Conteúdo no filesystem**, em `APPLICATIONS_DIR` (default `../job-search/applications`).
- **Metadados no banco**, na tabela `artifacts`: `kind`, `relative_path`, `mime`, `size_bytes`,
  `job_id`, `run_id`, `created_at`.
- O caminho é sempre **relativo** ao diretório base; nunca absoluto no banco.
- O servidor expõe `/applications/*` como estático e valida path traversal nos visualizadores.
- O importador não copia arquivos: apenas indexa os que existem.

## Consequências

**Positivas**

- Banco pequeno e rápido; backup do banco não inclui PDFs.
- Servir arquivos é trabalho do `express.static`, eficiente e com cache HTTP.
- O v1 e o v2 compartilham os mesmos arquivos durante a migração.
- Migrar para object storage (S3, Supabase Storage) é trocar `relativePath` por uma URL/chave.

**Negativas**

- Banco e disco podem divergir: registro sem arquivo (ou vice-versa). Os visualizadores tratam
  isso com mensagem de aviso.
- Backup precisa incluir os dois.
- Sem transação entre INSERT e escrita do arquivo. Aceitável porque a escrita é feita pelo pipeline
  antes do registro.
- Em nuvem, será necessário storage de objetos e URLs assinadas.

**Invariantes**

1. `relative_path` nunca começa com `/`.
2. `relative_path` resolvido deve permanecer dentro de `APPLICATIONS_DIR`.
3. O índice único `(job_id, kind, relative_path)` impede duplicata em reimportação.

## Referências

- [data-model.md](../data-model.md)
- [security.md](../security.md)
