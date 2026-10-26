import { appIcon } from "@/lib/app-icon";

// أيقونة تبويب المتصفح واختصارات صفحة جوجل
export const size = { width: 96, height: 96 };
export const contentType = "image/png";

export default function Icon() {
  return appIcon(96, { rounded: true });
}
