# Groundwork — affordable housing funding & compliance (prototype)

Enter a site, and a team of agents finds funding sources, extracts each program's rules,
scores your project against them using public data, and tracks post-award compliance.

```bash
npm install
npm run dev          # API on :8787, web on http://localhost:5173
```

Optional, in `.env` or your shell:

| Variable | Enables |
|---|---|
| `ANTHROPIC_API_KEY` | Claude-powered discovery (web search for state/local programs) and rule extraction from pasted QAPs/NOFAs |
| `CENSUS_API_KEY` | Higher Census API rate limits (works without one) |

Without a key the app runs in **knowledge-base mode** using the 15 bundled programs.

## What's inside

- **Agents** (`server/agents/`, orchestrated in `server/orchestrator.ts`, streamed over SSE):
  intake → geo + discovery (parallel) → rule extraction → scoring → compliance.
- **Geo agent** (`server/geo/`): Census Geocoder → tract GEOID; ACS 5-yr (income, poverty,
  tenure, rent burden, unemployment); HUD QCT/DDA; OpenStreetMap amenity distances; HUD AMI table.
  Every value is tagged live or fallback in the UI.
- **Knowledge base** (`server/data/programs.ts`): federal 9% LIHTC, CA TCAC / TX TDHCA / NY HCR 9%,
  4% LIHTC + bonds, HOME, HTF, CDBG, FHLB AHP, Section 811, HUD 221(d)(4), CA MHP, CA AHSC, TX MFDL, NY HTF —
  each with threshold + points rules (with citations) and compliance rules.
- **Rule DSL** (`shared/types.ts → RuleCheck`): one format for encoded and Claude-extracted rules,
  evaluated by `server/engine/evaluate.ts` with the math shown for every rule.
- **Compliance engine** (`server/engine/compliance.ts`): rent roll vs. income/rent limits, set-asides,
  recertifications, 140% rule, student rule, filing/inspection deadlines. CSV rent roll import.
- **Document pipeline + rule library** (`server/docs/`): long QAPs/NOFAs are never read whole.
  A free keyword pass drops TOCs, forms and boilerplate; a cheap model (Claude Haiku) triages the
  ambiguous pages; only relevant sections go to the extraction model, in parallel. Results are
  cached per funding source: re-adding a document costs $0, and a new edition re-reads only the
  sections that changed. Browse and reuse cached rules on the **Rule library** page.

See `ARCHITECTURE.md` for the API and module contract.

### Tuning the document pipeline

| Variable | Default | Purpose |
|---|---|---|
| `GROUNDWORK_TRIAGE_MODEL` | `claude-haiku-5-5` | model that triages ambiguous pages |
| `GROUNDWORK_EXTRACT_EFFORT` | `medium` | effort for section extraction (`low` / `medium` / `high`) |

Use the same **funding source name** for every edition of a program so cached work is reused.

### Tests

```bash
npm run test:engine   # scoring + compliance engine
npm run test:docs     # document pipeline (stubbed models, no API key needed)
```

## Caveats

- Scores are estimates. Encoded rules simplify real QAPs; verify against the current year's documents.
- The HUD AMI table (`server/geo/hudMfi.ts`) and fallback geo data were bundled offline and should be
  checked against HUD's published FY limits.
- Node's `fetch` doesn't use `HTTPS_PROXY`; live lookups need direct internet access.
