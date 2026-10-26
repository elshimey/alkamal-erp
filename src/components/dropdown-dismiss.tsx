"use client";

import { useEffect } from "react";

/**
 * القوائم المنسدلة (<details data-dropdown>): تُغلق بالضغط خارجها، أو باختيار عنصر منها، أو بـ Esc،
 * وفتح قائمة يغلق المفتوحة قبلها. مكوّن واحد للبرنامج كله بلا أي عرض.
 */
export function DropdownDismiss() {
  useEffect(() => {
    const openOnes = () => [...document.querySelectorAll<HTMLDetailsElement>("details[data-dropdown][open]")];
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      for (const d of openOnes()) if (!d.contains(t)) d.open = false;
    };
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.("a");
      const d = link?.closest<HTMLDetailsElement>("details[data-dropdown][open]");
      if (d) d.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") for (const d of openOnes()) d.open = false;
    };
    const onToggle = (e: Event) => {
      const d = e.target as HTMLDetailsElement;
      if (d.matches?.("details[data-dropdown]") && d.open) for (const o of openOnes()) if (o !== d && !o.contains(d)) o.open = false;
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    document.addEventListener("toggle", onToggle, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("toggle", onToggle, true);
    };
  }, []);
  return null;
}
