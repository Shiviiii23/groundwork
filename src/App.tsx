import clsx from "clsx";
import { BookMarked, Building2, FolderKanban, Landmark, Plus, ShieldCheck, Sparkles, Database } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useHealth } from "./lib/hooks";
import ProjectsPage from "./pages/Projects";
import NewProjectPage from "./pages/NewProject";
import ProjectDashboard from "./pages/ProjectDashboard";
import ProgramDetailPage from "./pages/ProgramDetail";
import FundingPage from "./pages/Funding";
import ComplianceListPage from "./pages/ComplianceList";
import ComplianceDashboard from "./pages/ComplianceDashboard";
import LibraryPage from "./pages/Library";

function NavItem({ to, icon, children, end }: { to: string; icon: ReactNode; children: ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        clsx(
          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
          isActive ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200" : "text-zinc-600 hover:bg-white/60 hover:text-zinc-900",
        )
      }
    >
      <span className="text-zinc-400">{icon}</span>
      {children}
    </NavLink>
  );
}

function HealthBadge() {
  const { health, down } = useHealth();
  if (down)
    return (
      <span className="flex items-center gap-1.5 text-xs text-red-700">
        <span className="h-2 w-2 rounded-full bg-red-500" /> API offline
      </span>
    );
  if (!health) return <span className="text-xs text-zinc-400">Connecting…</span>;
  return (
    <div className="flex items-center gap-3 text-xs">
      <span
        className={clsx(
          "flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 ring-inset",
          health.llmEnabled ? "bg-indigo-50 text-indigo-700 ring-indigo-200" : "bg-zinc-100 text-zinc-600 ring-zinc-200",
        )}
        title={health.llmEnabled ? `Claude-powered search & extraction (${health.model})` : "Set ANTHROPIC_API_KEY to enable web search & document extraction"}
      >
        <Sparkles size={12} />
        {health.llmEnabled ? "AI agents on" : "AI agents off · knowledge base only"}
      </span>
      <span
        className="flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-zinc-600 ring-1 ring-inset ring-zinc-200"
        title="Public data: Census Geocoder, ACS 5-Year, HUD QCT/DDA, OpenStreetMap. Falls back to bundled data when offline."
      >
        <Database size={12} />
        Census {health.censusKey ? "· keyed" : "· public"}
      </span>
    </div>
  );
}

export default function App() {
  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-zinc-200/80 bg-stone-100/70 px-3 py-5 md:flex">
        <div className="mb-8 flex items-center gap-2 px-3">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-white shadow-sm">
            <Building2 size={17} />
          </div>
          <div>
            <div className="text-[15px] font-semibold tracking-tight">Groundwork</div>
            <div className="text-[11px] text-zinc-500">Affordable housing finance</div>
          </div>
        </div>
        <nav className="space-y-1">
          <NavItem to="/projects" icon={<FolderKanban size={16} />} end>
            Projects
          </NavItem>
          <NavItem to="/projects/new" icon={<Plus size={16} />}>
            New project
          </NavItem>
          <NavItem to="/funding" icon={<Landmark size={16} />}>
            Funding
          </NavItem>
          <NavItem to="/library" icon={<BookMarked size={16} />}>
            Rule library
          </NavItem>
          <NavItem to="/compliance" icon={<ShieldCheck size={16} />}>
            Compliance
          </NavItem>
        </nav>
        <div className="mt-auto rounded-lg border border-zinc-200 bg-white/70 p-3 text-[11px] leading-relaxed text-zinc-500">
          Prototype. Scores are estimates from public data and encoded program rules — verify against the current QAP / NOFA before applying.
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-[500] flex h-14 items-center justify-between border-b border-zinc-200/80 bg-stone-50/85 px-6 backdrop-blur">
          <div className="flex items-center gap-2 md:hidden">
            <Building2 size={18} className="text-indigo-600" />
            <span className="font-semibold">Groundwork</span>
          </div>
          <nav className="flex gap-3 text-sm md:hidden">
            <NavLink to="/projects">Projects</NavLink>
            <NavLink to="/funding">Funding</NavLink>
            <NavLink to="/library">Library</NavLink>
            <NavLink to="/compliance">Compliance</NavLink>
          </nav>
          <div className="hidden md:block" />
          <HealthBadge />
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-6 py-8">
          <Routes>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/new" element={<NewProjectPage />} />
            <Route path="/projects/:id" element={<ProjectDashboard />} />
            <Route path="/projects/:id/programs/:programId" element={<ProgramDetailPage />} />
            <Route path="/funding" element={<FundingPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/compliance" element={<ComplianceListPage />} />
            <Route path="/compliance/:id" element={<ComplianceDashboard />} />
            <Route path="*" element={<Navigate to="/projects" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
