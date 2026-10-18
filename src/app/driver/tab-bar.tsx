"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";

export function TabBar({ tabs }: { tabs: { href: string; label: string; icon: IconName }[] }) {
  const path = usePathname();
  const active = (href: string) => (href === "/driver" ? path === "/driver" || path.startsWith("/driver/trips") : path.startsWith(href));
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-asphalt-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="road-line-h absolute inset-x-0 top-0 opacity-50" />
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {tabs.map((tab) => {
          const on = active(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition ${on ? "text-brand-500" : "text-white/55 hover:text-white"}`}
              >
                <span className={`flex h-7 w-12 items-center justify-center rounded-full transition ${on ? "bg-brand-600/20" : ""}`}>
                  <Icon name={tab.icon} className="size-5" />
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
