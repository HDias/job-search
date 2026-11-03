# Glossário

Termos usados no domínio e na documentação. Ordem alfabética.

## A

**ADR (Architecture Decision Record)**
Registro curto e imutável de uma decisão arquitetural, com contexto e consequências. Ficam em
[`adr/`](./adr/README.md).

**Artifact (artefato)**
Arquivo gerado pelo pipeline para uma candidatura: currículo em HTML/PDF, carta, e-mail, mensagem
para recrutador, sugestões de resposta. O conteúdo fica em `applications/`; o banco guarda apenas
metadados (`kind`, caminho relativo, mime, tamanho).

**`applications/`**
Diretório do v1 onde os artefatos vivem. O v2 referencia esse diretório via `APPLICATIONS_DIR`, sem
copiar os arquivos.

## B

**`base_profile/`**
Diretório com os currículos base extraídos (texto + metadados) por stack e idioma. Importado para
a tabela `profiles`.

## C

**Checkpoint**
Ver **Run**.

**Compatibilidade (camada de)**
Rotas e DTOs que traduzem o domínio v2 para o formato que a UI v1 consome. Ficam em
`src/api/dto/legacy.ts` e `src/api/routes/compat.ts`. Temporárias.

## D

**Document-shaped**
Modelo em que agregados complexos (`Fit`, `JobSnapshot`) são gravados como JSON em uma coluna, em
vez de tabelas normalizadas. Facilita a migração para um banco de documentos. Ver
[ADR-0002](./adr/0002-modelo-document-shaped.md).

**DTO (Data Transfer Object)**
Estrutura de resposta/entrada de uma rota. O DTO legado é o formato do v1; o DTO novo é o `Job` do
domínio.

## F

**Fit**
Avaliação de aderência entre candidato e vaga. Contém `rating` (0–100), `analysis`, `dimensions`
(`skillsMatch`, `experienceMatch`, `logisticsMatch`, `cultureMatch`), `strengths`, `gaps`,
`eligibility`, `languageGate` e `logisticsNote`.

**Fit híbrido**
Motor do v1 que combina regras determinísticas com LLM. Ainda não portado para o v2.

## J

**Job / Vaga**
Uma candidatura registrada. No v2, `jobs` é a fonte única de verdade para empresa, cargo, status,
idioma, stack e fit.

**JobSnapshot**
Cópia dos dados da vaga no momento do processamento: título, empresa, local, URLs, idioma
detectado, `content` (texto raspado), `extraQuestions` e `recruiterMessage`.

## L

**Legacy**
Tudo que pertence ao v1: `public/index.html`, `server.mjs`, JSONs e o formato `dd/mm/yyyy`.

## M

**Migration**
Script SQL versionado em `drizzle/` que altera o schema. Aplicado por `pnpm db:migrate` ou no boot.

## O

**`owner_id`**
Campo presente em `jobs` para preparar multiusuário. Hoje é sempre `local`.

## P

**Profile**
Currículo base por stack (`ruby`, `php`) e idioma (`pt-br`, `en`). Guarda o JSON original em
`content`.

## R

**Repository pattern**
Camada que isola o domínio do banco. Contratos em `src/repositories/types.ts`; implementação
SQLite em `src/repositories/sqlite/`. Permite trocar o banco sem tocar em rotas. Ver
[ADR-0003](./adr/0003-repository-pattern-e-nuvem.md).

**Run / Processo**
Checkpoint de um processamento. Guarda estágio, URL, idioma, flags, erro, fit e snapshot. Pode
existir sem vaga (`job_id = NULL`), preservando histórico.

## S

**Setting**
Par chave/valor em `settings`. Usado para `pdf_theme` e `candidate_form`.

**Stack**
Tecnologia principal do currículo/vaga: `ruby` ou `php`. Define qual perfil base é usado.

**Strangler (estrangulamento)**
Estratégia de substituir o v1 por partes, mantendo-o funcional até a última fatia migrar. Ver
[ADR-0004](./adr/0004-estrategia-strangler-compatibilidade-v1.md).

## T

**TanStack Query**
Biblioteca de cache e sincronização de dados planejada para a Fase 2.

## V

**Vitest**
Runner de testes usado no projeto.

**Vaga órfã (run órfão)**
Run cujo `job_id` é `NULL` porque a vaga correspondente não existe mais. Válido e esperado: 17 dos
34 runs importados estão nesse estado.
