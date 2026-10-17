// شجرة الحسابات الافتراضية وفق IFRS (المرجع: شجرة-الحسابات.md، الإصدار الأول).
// الأكواد اقتراح ويمكن تغييرها قبل التشغيل.
//
// المستوى يُستنتج من طول الرمز (1 ← قسم، 2 ← مجموعة، 4 ← حساب عام، 6 ← تفصيلي)،
// والأب من بادئة الرمز، والنوع من الرقم الأول. الحساب الذي ليس تحته حسابات يقبل الترحيل،
// وعند إضافة حساب فرعي تحته (بنك جديد، سائق جديد...) يصبح تجميعياً.

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "cost_of_revenue" | "expense";

export interface SeedAccount {
  code: string;
  nameAr: string;
  note?: string;
  currency?: string;
  // حساب مقابل (طبيعته عكس طبيعة قسمه)، مثل مجمع الإهلاك والخصومات
  contra?: boolean;
}

const RAW: SeedAccount[] = [
  { code: "1", nameAr: "الأصول" },
  { code: "11", nameAr: "الأصول المتداولة" },
  { code: "1101", nameAr: "النقد في الصناديق" },
  { code: "110101", nameAr: "الصندوق الرئيسي" },
  { code: "110102", nameAr: "صندوق المكتب" },
  { code: "110103", nameAr: "صندوق بالدينار الكويتي", currency: "KWD" },
  { code: "1102", nameAr: "النقد لدى البنوك", note: "حساب فرعي لكل بنك وعملة" },
  { code: "1103", nameAr: "الذمم المدينة التجارية (العملاء)", note: "حساب فرعي لكل عميل أو بُعد جهة الاتصال" },
  { code: "1104", nameAr: "مخصص الخسائر الائتمانية المتوقعة", note: "IFRS 9", contra: true },
  { code: "1105", nameAr: "عهد الموظفين والسائقين", note: "حساب فرعي لكل سائق/موظف" },
  { code: "1106", nameAr: "أرصدة بطاقات الوقود", note: "حساب فرعي لكل مزوّد" },
  { code: "1107", nameAr: "سلف الموظفين", note: "تشمل مقدم العمولة" },
  { code: "1108", nameAr: "ضريبة القيمة المضافة – مدخلات" },
  { code: "1109", nameAr: "مصروفات مدفوعة مقدماً", note: "تأمين، رسوم تجديد، إيجارات قصيرة" },
  { code: "1110", nameAr: "مخزون قطع الغيار والإطارات" },
  { code: "1111", nameAr: "دفعات مقدمة للموردين" },
  { code: "1112", nameAr: "إيرادات مستحقة غير مفوترة", note: "IFRS 15، تُعكس أول الشهر التالي" },
  { code: "1113", nameAr: "ذمم مدينة أخرى" },
  { code: "12", nameAr: "الأصول غير المتداولة" },
  { code: "1201", nameAr: "الممتلكات والآلات والمعدات – بالتكلفة", note: "IAS 16" },
  { code: "120101", nameAr: "الشاحنات (الرؤوس)" },
  { code: "120102", nameAr: "المقطورات" },
  { code: "120103", nameAr: "السيارات الخفيفة" },
  { code: "120104", nameAr: "معدات الورشة" },
  { code: "120105", nameAr: "الأثاث والأجهزة" },
  { code: "120106", nameAr: "المباني والتحسينات" },
  { code: "1202", nameAr: "مجمع الإهلاك", contra: true },
  { code: "120201", nameAr: "مجمع إهلاك الشاحنات (الرؤوس)", contra: true },
  { code: "120202", nameAr: "مجمع إهلاك المقطورات", contra: true },
  { code: "120203", nameAr: "مجمع إهلاك السيارات الخفيفة", contra: true },
  { code: "120204", nameAr: "مجمع إهلاك معدات الورشة", contra: true },
  { code: "120205", nameAr: "مجمع إهلاك الأثاث والأجهزة", contra: true },
  { code: "120206", nameAr: "مجمع إهلاك المباني والتحسينات", contra: true },
  { code: "1203", nameAr: "أصول حق الاستخدام", note: "IFRS 16" },
  { code: "1204", nameAr: "مجمع إهلاك أصول حق الاستخدام", contra: true },
  { code: "1205", nameAr: "مشروعات تحت التنفيذ" },
  { code: "1206", nameAr: "الأصول غير الملموسة", note: "البرامج والتراخيص" },
  { code: "1207", nameAr: "مجمع إطفاء الأصول غير الملموسة", contra: true },

  { code: "2", nameAr: "الالتزامات" },
  { code: "21", nameAr: "الالتزامات المتداولة" },
  { code: "2101", nameAr: "الذمم الدائنة التجارية (الموردون)" },
  { code: "2102", nameAr: "الناقلون الخارجيون", note: "حساب فرعي لكل ناقل" },
  { code: "2103", nameAr: "محطات الوقود بالآجل" },
  { code: "2104", nameAr: "الورش الخارجية" },
  { code: "2105", nameAr: "المخلصون الجمركيون" },
  { code: "2106", nameAr: "مصروفات مستحقة" },
  { code: "2107", nameAr: "رواتب وأجور مستحقة", note: "حساب فرعي لكل موظف/سائق" },
  { code: "2108", nameAr: "مخالفات مستحقة الدفع" },
  { code: "2109", nameAr: "ضريبة القيمة المضافة – مخرجات" },
  { code: "2110", nameAr: "ضريبة القيمة المضافة – صافي مستحق" },
  { code: "2111", nameAr: "الزكاة المستحقة" },
  { code: "2112", nameAr: "دفعات مقدمة من العملاء" },
  { code: "2113", nameAr: "التزامات عقود الإيجار – الجزء المتداول" },
  { code: "2114", nameAr: "قروض قصيرة الأجل والجزء المتداول من القروض" },
  { code: "2115", nameAr: "التأمينات الاجتماعية المستحقة" },
  { code: "22", nameAr: "الالتزامات غير المتداولة" },
  { code: "2201", nameAr: "قروض طويلة الأجل", note: "تمويل الشاحنات" },
  { code: "2202", nameAr: "التزامات عقود الإيجار – غير متداولة" },
  { code: "2203", nameAr: "مخصص مكافأة نهاية الخدمة", note: "IAS 19" },

  { code: "3", nameAr: "حقوق الملكية" },
  { code: "31", nameAr: "حقوق الملكية" },
  { code: "3101", nameAr: "رأس المال" },
  { code: "3102", nameAr: "الاحتياطي النظامي" },
  { code: "3103", nameAr: "الأرباح المبقاة / الخسائر المتراكمة" },
  { code: "3104", nameAr: "جاري الشركاء / المالك" },
  { code: "3105", nameAr: "صافي ربح (خسارة) السنة", note: "يُقفل في 3103 نهاية السنة" },

  { code: "4", nameAr: "الإيرادات" },
  { code: "41", nameAr: "إيرادات النقل" },
  { code: "4101", nameAr: "إيراد النقل الداخلي", note: "ضريبة 15%" },
  { code: "4102", nameAr: "إيراد النقل الدولي", note: "ضريبة 0%" },
  { code: "4103", nameAr: "إيراد رسوم محمّلة على العملاء", note: "انتظار، تحميل، تخليص، مبيت" },
  { code: "4104", nameAr: "إيراد مصاريف دولية مستردة من العملاء" },
  { code: "4105", nameAr: "خصومات ومسموحات المبيعات", contra: true },
  { code: "42", nameAr: "إيرادات أخرى" },
  { code: "4201", nameAr: "إيرادات أخرى", note: "بيع خردة، تعويضات تأمين" },
  { code: "4202", nameAr: "أرباح بيع أصول" },

  { code: "5", nameAr: "تكلفة الإيراد" },
  { code: "51", nameAr: "تكاليف التشغيل المباشرة" },
  { code: "5101", nameAr: "تكلفة الديزل" },
  { code: "5102", nameAr: "عمولات السائقين" },
  { code: "5103", nameAr: "رواتب وبدلات السائقين" },
  { code: "5104", nameAr: "تكاليف النقل الدولي والحدود" },
  { code: "5105", nameAr: "تكلفة الناقلين الخارجيين" },
  { code: "5106", nameAr: "الرسوم الحكومية والطرق" },
  { code: "5107", nameAr: "صيانة وإصلاح المركبات" },
  { code: "5108", nameAr: "الإطارات" },
  { code: "5109", nameAr: "تأمين المركبات" },
  { code: "5110", nameAr: "إهلاك الشاحنات والمقطورات" },
  { code: "5111", nameAr: "إهلاك أصول حق الاستخدام – مركبات" },
  { code: "5112", nameAr: "مصاريف طريق أخرى للسائقين" },
  { code: "5113", nameAr: "مخالفات على الشركة" },
  { code: "5114", nameAr: "عمولات المناديب" },

  { code: "6", nameAr: "المصروفات الإدارية والعمومية" },
  { code: "61", nameAr: "المصروفات الإدارية والعمومية" },
  { code: "6101", nameAr: "رواتب وبدلات الموظفين الإداريين" },
  { code: "6102", nameAr: "التأمينات الاجتماعية" },
  { code: "6103", nameAr: "مكافأة نهاية الخدمة" },
  { code: "6104", nameAr: "رسوم الإقامات والتأشيرات ومكتب العمل" },
  { code: "6105", nameAr: "الإيجارات قصيرة الأجل" },
  { code: "6106", nameAr: "الكهرباء والمياه والاتصالات" },
  { code: "6107", nameAr: "الأتعاب المهنية والاستشارات" },
  { code: "6108", nameAr: "الرسوم البنكية" },
  { code: "6109", nameAr: "القرطاسية والضيافة" },
  { code: "6110", nameAr: "إهلاك الأصول الإدارية" },
  { code: "6111", nameAr: "الاشتراكات والبرامج" },
  { code: "6112", nameAr: "مصروف الخسائر الائتمانية المتوقعة" },
  { code: "6113", nameAr: "مصروفات أخرى" },

  { code: "7", nameAr: "التمويل والبنود الأخرى والزكاة" },
  { code: "71", nameAr: "تكاليف التمويل والبنود الأخرى" },
  { code: "7101", nameAr: "تكاليف التمويل – القروض" },
  { code: "7102", nameAr: "تكاليف التمويل – عقود الإيجار" },
  { code: "7103", nameAr: "أرباح (خسائر) فروق العملة", note: "IAS 21، من الدينار الكويتي" },
  { code: "7104", nameAr: "خسائر بيع أصول" },
  { code: "72", nameAr: "الزكاة" },
  { code: "7201", nameAr: "مصروف الزكاة" },
];

const TYPE_BY_SECTION: Record<string, AccountType> = {
  "1": "asset",
  "2": "liability",
  "3": "equity",
  "4": "revenue",
  "5": "cost_of_revenue",
  "6": "expense",
  "7": "expense",
};

const LEVEL_BY_LENGTH: Record<number, number> = { 1: 1, 2: 2, 4: 3, 6: 4 };

export interface ResolvedAccount extends SeedAccount {
  parentCode: string | null;
  level: number;
  type: AccountType;
  normalBalance: "debit" | "credit";
  isPostable: boolean;
  requiresCostCenter: boolean;
}

export function parentCodeOf(code: string): string | null {
  if (code.length === 1) return null;
  if (code.length === 2) return code.slice(0, 1);
  return code.slice(0, code.length - 2);
}

export function resolveChart(raw: SeedAccount[] = RAW): ResolvedAccount[] {
  const codes = new Set(raw.map((a) => a.code));
  const hasChildren = new Set(raw.map((a) => parentCodeOf(a.code)).filter(Boolean) as string[]);
  return raw.map((a) => {
    const level = LEVEL_BY_LENGTH[a.code.length];
    if (!level) throw new Error(`طول رمز غير صالح: ${a.code}`);
    const parentCode = parentCodeOf(a.code);
    if (parentCode && !codes.has(parentCode)) throw new Error(`الحساب ${a.code} بلا أب ${parentCode}`);
    const type = TYPE_BY_SECTION[a.code[0]];
    const natural = type === "asset" || type === "cost_of_revenue" || type === "expense" ? "debit" : "credit";
    const normalBalance = a.contra ? (natural === "debit" ? "credit" : "debit") : natural;
    const isPostable = !hasChildren.has(a.code);
    return {
      ...a,
      parentCode,
      level,
      type,
      normalBalance,
      isPostable,
      // القرار 8: كل سطر تكلفة تشغيل يحمل المركبة كمركز تكلفة، فتخرج منه ربحية كل مركبة
      requiresCostCenter: type === "cost_of_revenue" && isPostable,
    };
  });
}

export const CHART_OF_ACCOUNTS = resolveChart();
