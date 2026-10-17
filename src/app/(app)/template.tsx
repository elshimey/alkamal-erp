// يُعاد تركيبه مع كل انتقال، فتدخل كل صفحة بحركة انزلاق خفيفة.
export default function PageTransition({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
