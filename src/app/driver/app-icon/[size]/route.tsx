import { appIcon } from "@/lib/app-icon";

// أيقونة التطبيق بالأحجام التي يطلبها ملف التثبيت
export async function GET(_: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = [180, 192, 512].includes(Number((await params).size)) ? Number((await params).size) : 192;
  return appIcon(size);
}
