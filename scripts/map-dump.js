/* eslint-disable */
// يُنفَّذ داخل المتصفح (scripts/map-screens.ts): يكتب محتوى الطبقة الظاهرة بالترتيب.
(sel) => {
  const root = Array.from(document.querySelectorAll(sel)).pop() || document.body;
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const t = (e) => ((e && e.textContent) || "").replace(/\s+/g, " ").trim().slice(0, 70);
  const out = [];
  root.querySelectorAll("h1,h2,summary,label,button,a,th").forEach((e) => {
    if (e.closest("[data-tour-ui]")) return;
    const tag = e.tagName.toLowerCase();
    if (tag === "label") {
      const head = e.querySelector("span");
      const inp = e.querySelector("input:not([type=hidden]),select,textarea,[role=combobox]");
      const kind = inp ? (inp.getAttribute("role") === "combobox" ? "combo" : inp.tagName.toLowerCase() === "input" ? "input:" + inp.type : inp.tagName.toLowerCase()) : "-";
      out.push((vis(e) ? "" : "(hidden) ") + "field «" + (t(head) || t(e)) + "» " + kind + (inp && inp.required ? " required" : ""));
    } else if (tag === "summary") out.push("section «" + (t(e.querySelector("span")) || t(e)) + "»" + (e.parentElement.open ? "" : " (closed)"));
    else if (tag === "a") {
      if (!e.closest("nav,aside") && vis(e)) out.push("link «" + t(e) + "» " + e.getAttribute("href"));
    } else if (tag === "th") {
      if (vis(e)) out.push("col «" + t(e) + "»");
    } else if (vis(e)) out.push(tag + " «" + (t(e) || e.getAttribute("aria-label")) + "»");
  });
  return out.filter((l, i, a) => a.indexOf(l) === i);
}
