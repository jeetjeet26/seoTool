"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="state-page"><span className="logo-mark large">!</span><h1>Something went wrong</h1><p>The page could not be prepared. Try loading it again.</p><button className="button primary" onClick={reset}>Try again</button></main>;
}
