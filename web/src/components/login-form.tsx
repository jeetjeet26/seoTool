"use client";

import { useActionState } from "react";

import { signIn, type LoginState } from "@/app/login/actions";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, initialState);

  return (
    <form className="auth-form" action={action}>
      <div>
        <h2>Welcome back</h2>
        <p>Sign in to continue to your workspace.</p>
      </div>
      <label>
        Email address
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
        />
      </label>
      <label>
        <span className="label-line">
          <span>Password</span>
        </span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          placeholder="Enter your password"
        />
      </label>
      {state.error ? (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      ) : null}
      <button className="button primary full" type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
