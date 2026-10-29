// عنوان الرجوع بعد إجراء يأتي من المتصفح؛ يُقبل مساراً داخل البرنامج فقط، فلا يُعاد التوجيه لموقع خارجي
export const localPath = (back: string, fallback: string) => (/^\/(?![/\\])/.test(back) ? back : fallback);
