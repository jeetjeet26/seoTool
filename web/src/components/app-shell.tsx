import Link from "next/link";
import type { CurrentProfile } from "@/lib/auth/user";
import { Icon } from "./icons";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: "home" as const },
  { href: "/clients", label: "Clients", icon: "users" as const },
  { href: "/audits", label: "Audits", icon: "scan" as const },
  { href: "/tools", label: "Tools", icon: "wrench" as const },
];

export function AppShell({
  children,
  profile,
}: {
  children: React.ReactNode;
  profile: CurrentProfile;
}) {
  const initials = profile.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="wordmark" href="/dashboard" aria-label="Audit workspace home">
          <span className="logo-mark">A</span><span>Audit workspace</span>
        </Link>
        <nav aria-label="Primary navigation">
          {nav.map((item) => <Link href={item.href} key={item.href}><Icon name={item.icon}/>{item.label}</Link>)}
        </nav>
        <div className="sidebar-foot">
          <div className="avatar">{initials}</div>
          <div><strong>{profile.displayName}</strong><small>Workspace {profile.role}</small></div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="mobile-brand"><span className="logo-mark">A</span> Audits</div>
          <label className="search"><Icon name="search"/><span className="sr-only">Search workspace</span><input placeholder="Search clients and audits" /></label>
          <Link className="button primary compact" href="/audits/new"><Icon name="plus"/>New audit</Link>
        </header>
        <main className="page">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return <div className="page-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="lede">{description}</p>}</div>{action}</div>;
}

export function Status({ value }: { value: string }) {
  return <span className={`status status-${value.toLowerCase()}`}><span />{value}</span>;
}
