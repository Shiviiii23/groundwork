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

See `ARCHITECTURE.md` for the API and module contract.

## Caveats

- Scores are estimates. Encoded rules simplify real QAPs; verify against the current year's documents.
- The HUD AMI table (`server/geo/hudMfi.ts`) and fallback geo data were bundled offline and should be
  checked against HUD's published FY limits.
- Node's `fetch` doesn't use `HTTPS_PROXY`; live lookups need direct internet access.
