// ترحيب الدخول ووداع الخروج: رسائل قصيرة تتغير مع الوقت حتى لا تتكرر كل يوم بالنص نفسه

export const WELCOME_COOKIE = "erp_welcome";

const CHEERS = [
  "يومك موفق، وكل رحلة تصل بسلام.",
  "بالتوفيق في يوم عمل منجز.",
  "كل شحنة تُسجَّل اليوم خطوة نحو أرقام أوضح.",
  "جاهزون؟ الطريق مفتوح والأرقام بانتظارك.",
  "نتمنى لك يوماً هادئاً وإنجازاً كبيراً.",
  "خطوة بخطوة، والحسابات تبقى مرتبة.",
];

const FAREWELLS = [
  "شكراً على جهدك اليوم، نراك قريباً.",
  "يعطيك العافية، بياناتك محفوظة بأمان.",
  "أحسنت اليوم، استرح جيداً.",
  "رافقتك السلامة، ونلقاك في الرحلة القادمة.",
];

const riyadhHour = (d = new Date()) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", hourCycle: "h23" }).format(d));
const pick = (list: string[], d = new Date()) => list[(d.getUTCDate() + d.getUTCHours()) % list.length];

export function welcomeMessage(name: string, d = new Date()) {
  const h = riyadhHour(d);
  const greet = h >= 4 && h < 12 ? "صباح الخير" : h < 18 ? "مساء الخير" : "مساء النور";
  return { title: `${greet} يا ${name.trim().split(/\s+/)[0]}، أهلاً بعودتك`, text: pick(CHEERS, d) };
}

export function farewellMessage(name: string, d = new Date()) {
  return { title: `إلى اللقاء يا ${name}`, text: pick(FAREWELLS, d) };
}
