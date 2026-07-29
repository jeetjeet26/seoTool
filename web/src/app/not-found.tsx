import Link from "next/link";

export default function NotFound() {
  return <main className="state-page"><span className="logo-mark large">404</span><h1>That record was not found</h1><p>The link may be outdated or the record may have been removed.</p><Link className="button primary" href="/dashboard">Return to dashboard</Link></main>;
}
