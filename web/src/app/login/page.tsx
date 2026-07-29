import Link from "next/link";

import { LoginForm } from "@/components/login-form";
import { isSupabaseConfigured } from "@/lib/config";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="auth-page">
      <div className="auth-panel">
        <Link href="/" className="wordmark">
          <span className="logo-mark">A</span>
          <span>Audit workspace</span>
        </Link>
        <div className="auth-copy">
          <p className="eyebrow">Technical SEO operations</p>
          <h1>
            Clear findings.
            <br />
            Confident decisions.
          </h1>
          <p>
            Run audits, prioritize technical work, and publish client-ready
            reports from one focused workspace.
          </p>
        </div>
        <small>
          {isSupabaseConfigured
            ? "Protected internal workspace"
            : "Supabase is not configured"}
        </small>
      </div>
      <div className="auth-form-wrap">
        <LoginForm />
      </div>
    </main>
  );
}
