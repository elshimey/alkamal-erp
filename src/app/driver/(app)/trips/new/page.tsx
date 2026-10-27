import { redirect } from "next/navigation";

// الرحلات يفتحها المكتب ويرسلها للسائق؛ الرابط القديم يعود لقائمة الرحلات
export default function NewTrip() {
  redirect("/driver");
}
