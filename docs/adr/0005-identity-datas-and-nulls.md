# ADR-0005 — Identity, dates and nulls

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

v1 used numeric IDs coupled to `Date.now()` (`app_1793504688485`), display dates (`28/10/2026`)
and `undefined` in several places. This creates theoretical collisions, incorrect ordering and
problems when persisting to databases that reject `undefined` (Firestore).

## Decision

### IDs

- Prefix per type + UUID: `app_<uuid>`, `proc_<uuid>`, `art_<uuid>`.
- IDs are opaque to the UI; never infer type from the format beyond the prefix.
- IDs imported from v1 are **preserved** when they already have a prefix, so links and artifact
  references don't break.

### Dates

- Persistence and transport in **ISO 8601 UTC** (`2026-10-28T12:00:00.000Z`).
- Conversion to `dd/mm/yyyy` **only** in the compatibility DTO (`isoToBrDate`).
- Invalid dates during import become `null` with a warning; never `Invalid Date`.

### Nulls

- Missing fields are `null`, never `undefined`.
- `nullify()` normalizes on write; `parseFit`/`parseJobSnapshot` normalize on read.
- Booleans are `0/1` in SQLite and converted to `boolean` in the mapper.

## Consequences

**Positive**

- Lexicographic ordering of ISO equals chronological ordering.
- No timezone ambiguity: everything is UTC; the UI formats locally.
- Compatible with Firestore, which rejects `undefined`.
- UUIDs avoid collisions in imports and in a possible multi-user future.

**Negative**

- Native JS `Date` is not used in the domain; strings require discipline.
- The UI must format dates for the user.
- Preserving old IDs means living with two formats (`app_<timestamp>` and `app_<uuid>`).

**Rule**

Never compare dates as strings without guaranteeing ISO. For "today", use the user's timezone only
in presentation.

## References

- [data-model.md](../data-model.md)
- `src/domain/dates.ts`
- `src/domain/ids.ts`
