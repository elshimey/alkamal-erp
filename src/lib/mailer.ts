import "server-only";
import nodemailer from "nodemailer";

// إرسال البريد عبر SMTP (Gmail بكلمة مرور تطبيق، أو أي مزود). الإعداد من متغيرات البيئة في Vercel:
// SMTP_USER و SMTP_PASS إلزاميان، و SMTP_HOST (افتراضياً smtp.gmail.com) و SMTP_PORT (465) و MAIL_FROM اختيارية.
// MAIL_TRANSPORT=log يطبع الرسالة في سجل الخادم بدل إرسالها (للتجربة المحلية).

export const mailConfigured = () => process.env.MAIL_TRANSPORT === "log" || !!(process.env.SMTP_USER && process.env.SMTP_PASS);

export async function sendMail(msg: { to: string; subject: string; text: string; html: string; fromName: string }) {
  if (process.env.MAIL_TRANSPORT === "log") {
    console.log(`[mail] to=${msg.to} subject=${msg.subject}\n${msg.text}`);
    return;
  }
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transport.sendMail({
    from: { name: msg.fromName, address: process.env.MAIL_FROM || process.env.SMTP_USER! },
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
}
