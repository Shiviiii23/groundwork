import fs from "node:fs";
import path from "node:path";
import type { ComplianceRule, LibrarySource, LibrarySourceDetail, LibraryVersion, Rule } from "../../shared/types";

/**
 * Rule library: extracted rules cached per funding source, persisted to server/.data/library.json.
 * Three layers, all scoped to one source so editions of the same program share work but
 * unrelated programs never do:
 *  - versions:  whole-document results keyed by document hash (identical upload → zero model calls)
 *  - sections:  per-section extractions keyed by the hash of their pages (new edition → only changed sections re-read)
 *  - triage:    per-page relevance verdicts keyed by page hash
 */

export type ProgramMeta = LibrarySourceDetail["program"];

export interface CachedRules {
  program: ProgramMeta;
  rules: Rule[]; // programId "" and un-prefixed ids
  complianceRules: ComplianceRule[];
}

interface StoredVersion extends LibraryVersion, CachedRules {}
interface StoredSource extends Omit<LibrarySource, "versions"> {
  versions: StoredVersion[];
}
interface SectionEntry extends CachedRules {
  costUsd: number;
  at: string;
}
interface LibraryFile {
  sources: Record<string, StoredSource>;
  docIndex: Record<string, string>; // docHash → sourceKey
  sections: Record<string, Record<string, SectionEntry>>;
  triage: Record<string, Record<string, boolean>>;
}

const FILE = process.env.GROUNDWORK_LIBRARY_FILE || path.resolve(process.cwd(), "server/.data/library.json");

export function sourceKeyFor(nameOrUrl: string): string {
  const s = nameOrUrl.trim().toLowerCase();
  const base = /^https?:\/\//.test(s) ? s.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "") : s;
  return base.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "untitled";
}

class Library {
  private data: LibraryFile;
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    try {
      this.data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    } catch {
      this.data = { sources: {}, docIndex: {}, sections: {}, triage: {} };
    }
  }

  private save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(this.data));
    }, 300);
  }

  list(): LibrarySource[] {
    return Object.values(this.data.sources)
      .map((s) => ({ ...s, versions: s.versions.map(publicVersion) }))
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  }

  detail(key: string): LibrarySourceDetail | null {
    const s = this.data.sources[key];
    const v = s?.versions[0];
    if (!s || !v) return null;
    return { source: { ...s, versions: s.versions.map(publicVersion) }, program: v.program, rules: v.rules, complianceRules: v.complianceRules };
  }

  /** Latest edition of a source, or a specific document if it's already been processed. */
  latest(key: string): StoredVersion | null {
    return this.data.sources[key]?.versions[0] ?? null;
  }

  findDoc(docHash: string): { sourceKey: string; version: StoredVersion } | null {
    const sourceKey = this.data.docIndex[docHash];
    const version = sourceKey ? this.data.sources[sourceKey]?.versions.find((v) => v.docHash === docHash) : undefined;
    return sourceKey && version ? { sourceKey, version } : null;
  }

  triage(key: string, pageHash: string): boolean | undefined {
    return this.data.triage[key]?.[pageHash];
  }

  setTriage(key: string, verdicts: Record<string, boolean>) {
    this.data.triage[key] = { ...this.data.triage[key], ...verdicts };
    this.save();
  }

  section(key: string, hash: string): SectionEntry | undefined {
    return this.data.sections[key]?.[hash];
  }

  setSection(key: string, hash: string, entry: SectionEntry) {
    (this.data.sections[key] ??= {})[hash] = entry;
    this.save();
  }

  addVersion(key: string, meta: { name: string; administrator?: string; url?: string }, version: StoredVersion) {
    const now = new Date().toISOString();
    const s = (this.data.sources[key] ??= { sourceKey: key, name: meta.name, hits: 0, lastUsedAt: now, totalCostUsd: 0, savedUsd: 0, versions: [] });
    s.name = meta.name || s.name;
    s.administrator = meta.administrator || version.program.administrator || s.administrator;
    s.url = meta.url || s.url;
    s.versions = [version, ...s.versions.filter((v) => v.docHash !== version.docHash)];
    s.totalCostUsd += version.stats.costUsd;
    s.savedUsd += Math.max(0, version.stats.savedUsdEst);
    s.lastUsedAt = now;
    this.data.docIndex[version.docHash] = key;
    this.save();
  }

  recordHit(key: string, savedUsd: number) {
    const s = this.data.sources[key];
    if (!s) return;
    s.hits += 1;
    s.savedUsd += Math.max(0, savedUsd);
    s.lastUsedAt = new Date().toISOString();
    this.save();
  }

  remove(key: string): boolean {
    if (!this.data.sources[key]) return false;
    for (const v of this.data.sources[key].versions) delete this.data.docIndex[v.docHash];
    delete this.data.sources[key];
    delete this.data.sections[key];
    delete this.data.triage[key];
    this.save();
    return true;
  }
}

function publicVersion(v: StoredVersion): LibraryVersion {
  const { program: _p, rules: _r, complianceRules: _c, ...pub } = v;
  return pub;
}

export const library = new Library();

/** Attaches cached rules to a concrete program id. */
export function rehydrate(programId: string, cached: Pick<CachedRules, "rules" | "complianceRules">): { rules: Rule[]; complianceRules: ComplianceRule[] } {
  return {
    rules: cached.rules.map((r) => ({ ...r, programId, id: `${programId}.${r.id}` })),
    complianceRules: cached.complianceRules.map((r) => ({ ...r, programId, id: `${programId}.${r.id}` })),
  };
}
