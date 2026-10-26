// يظهر فوراً عند الانتقال لصفحة أخرى حتى تصل بياناتها (مع شاحنة شريط الانتقال في الأعلى): هيكل الصفحة بلمعة خفيفة
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="جارٍ التحميل" className="loading-delay space-y-3">
      <div className="skeleton h-8 w-56 rounded-lg" />
      <div className="skeleton h-4 w-80 max-w-full rounded" />
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-24 rounded-2xl" />
        ))}
      </div>
      <div className="skeleton mt-4 h-64 rounded-2xl" />
    </div>
  );
}
