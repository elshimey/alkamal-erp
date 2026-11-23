import Link from "next/link";
import { msgSegments } from "@/lib/msg-links";

const LINK = "font-semibold underline decoration-2 underline-offset-2 hover:opacity-80";

/** نص رسالة الخطأ أو التنبيه مع روابط الصفحات التي توجّه إليها (`msgSegments`). */
export function MsgText({ text }: { text: string }) {
  return (
    <>
      {msgSegments(text).map((s, i) =>
        s.href ? (
          <Link key={i} href={s.href} className={LINK} data-msg-link>
            {s.text}
          </Link>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/** نفس الرسالة لعنصر يُبنى دون React (رسالة أسفل الشاشة). */
export function fillMsg(el: HTMLElement, text: string) {
  el.textContent = "";
  for (const s of msgSegments(text)) {
    if (!s.href) {
      el.append(s.text);
      continue;
    }
    const a = document.createElement("a");
    a.href = s.href;
    a.textContent = s.text;
    a.className = LINK;
    a.dataset.msgLink = "";
    el.append(a);
  }
}
