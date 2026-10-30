"use client";

import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { markAllRead, markRead } from "./actions";

/** يعلّم التنبيه مقروءاً ثم يفتح شاشته. */
export function OpenAlert({ alertKey, href, className, children }: { alertKey: string; href: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await markRead(alertKey);
          router.push(href);
        })
      }
      className={className}
    >
      {children}
    </button>
  );
}

export function MarkAllButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await markAllRead();
          window.dispatchEvent(new Event("alerts-changed"));
          router.refresh();
        })
      }
      className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-60"
    >
      تعليم الكل كمقروء
    </button>
  );
}
