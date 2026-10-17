// بيانات المنشأة على الفاتورة المطبوعة. الرقم الضريبي والسجل يُضبطان من متغيرات البيئة
// (COMPANY_VAT_NUMBER، COMPANY_CR_NUMBER، COMPANY_ADDRESS) إلى أن تُبنى شاشة الإعدادات.
export const COMPANY = {
  nameAr: "الكمال للنقليات",
  vatNumber: process.env.COMPANY_VAT_NUMBER ?? "",
  crNumber: process.env.COMPANY_CR_NUMBER ?? "",
  address: process.env.COMPANY_ADDRESS ?? "المملكة العربية السعودية",
};
