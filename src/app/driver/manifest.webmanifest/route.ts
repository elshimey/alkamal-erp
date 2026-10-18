// يجعل تطبيق السائق قابلاً للإضافة للشاشة الرئيسية ويفتح بملء الشاشة كتطبيق
export function GET() {
  return Response.json(
    {
      name: "الكمال للنقليات – السائق",
      short_name: "الكمال – السائق",
      start_url: "/driver",
      scope: "/driver",
      display: "standalone",
      orientation: "portrait",
      dir: "rtl",
      lang: "ar",
      background_color: "#f3f1eb",
      theme_color: "#1b2126",
      icons: [192, 512].map((size) => ({ src: `/driver/app-icon/${size}`, sizes: `${size}x${size}`, type: "image/png", purpose: "any maskable" })),
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
