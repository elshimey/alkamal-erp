import { ImageResponse } from "next/og";

// أيقونة التطبيق: شارة الطريق السداسية على الأسفلت
export async function GET(_: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = [180, 192, 512].includes(Number((await params).size)) ? Number((await params).size) : 192;
  const mark = Math.round(size * 0.62);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#1b2126" }}>
        <svg width={mark} height={mark} viewBox="0 0 40 40">
          <path d="M20 2 36 11v18L20 38 4 29V11Z" fill="#e9a100" />
          <path d="M15 33 18.5 9h3L25 33Z" fill="#1b2126" />
          <path d="M19.4 13h1.2l.4 4h-2Zm-.5 7h2.2l.4 5h-3Z" fill="#e9a100" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
