// تفقيط المبالغ: كتابة المبلغ بالحروف العربية في السندات («فقط ألف ريال لا غير»).

const ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"];
const TEENS = ["عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];
// المفرد، المثنى، الجمع (3-10)
const SCALES: [string, string, string][] = [
  ["", "", ""],
  ["ألف", "ألفان", "آلاف"],
  ["مليون", "مليونان", "ملايين"],
  ["مليار", "ملياران", "مليارات"],
];

function belowThousand(n: number) {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (r >= 20) parts.push(r % 10 ? `${ONES[r % 10]} و${TENS[Math.floor(r / 10)]}` : TENS[Math.floor(r / 10)]);
  else if (r >= 10) parts.push(TEENS[r - 10]);
  else if (r) parts.push(ONES[r]);
  return parts.join(" و");
}

/** العدد الصحيح بالحروف (حتى أقل من تريليون). */
export function numberToArabicWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "صفر";
  const groups: string[] = [];
  for (let scale = 0; n > 0 && scale < SCALES.length; scale++, n = Math.floor(n / 1000)) {
    const g = n % 1000;
    if (!g) continue;
    if (scale === 0) {
      groups.unshift(belowThousand(g));
      continue;
    }
    const [one, two, many] = SCALES[scale];
    if (g === 1) groups.unshift(one);
    else if (g === 2) groups.unshift(two);
    else if (g <= 10) groups.unshift(`${belowThousand(g)} ${many}`);
    else groups.unshift(`${belowThousand(g)} ${one}`);
  }
  return groups.join(" و");
}

const CURRENCIES: Record<string, { main: string; sub: string; subUnits: number }> = {
  SAR: { main: "ريال سعودي", sub: "هللة", subUnits: 100 },
  KWD: { main: "دينار كويتي", sub: "فلس", subUnits: 1000 },
  USD: { main: "دولار أمريكي", sub: "سنت", subUnits: 100 },
  AED: { main: "درهم إماراتي", sub: "فلس", subUnits: 100 },
};

/** «فقط ألف وخمسمائة ريال سعودي وخمسون هللة لا غير». */
export function amountInWords(amount: number, currencyCode = "SAR") {
  const c = CURRENCIES[currencyCode] ?? { main: currencyCode, sub: "", subUnits: 100 };
  const whole = Math.floor(amount + 1e-9);
  const fraction = Math.round((amount - whole) * c.subUnits);
  const sub = fraction > 0 && c.sub ? ` و${numberToArabicWords(fraction)} ${c.sub}` : "";
  return `فقط ${numberToArabicWords(whole)} ${c.main}${sub} لا غير`;
}
