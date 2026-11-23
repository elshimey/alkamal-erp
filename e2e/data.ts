// بيانات الدخول والأسماء المشتركة بين تجهيز القاعدة والاختبارات (قاعدة اختبار فقط، لا أسرار حقيقية)
export const E2E = {
  company: "home",
  admin: { login: "admin", password: "e2e-admin-pass" },
  driver: { name: "سائق الاختبار", login: "0555000111", password: "e2e-driver-pass" },
  beta: { code: "beta", login: "beta_admin", password: "e2e-beta-pass", secretCustomer: "عميل بيتا السري" },
  customer: "عميل الاختبار",
  linkCustomer: "عميل رابط المراجعة",
  plate: "ا ب ج 1234",
  price: 2500,
};
