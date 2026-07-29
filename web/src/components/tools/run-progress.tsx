"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function RunAutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(interval);
  }, [active, router]);

  return null;
}
