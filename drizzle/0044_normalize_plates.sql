-- توحيد صيغة اللوحات المحفوظة إلى «ا ب ج 1234» (ملاحظة التشغيل 1): كانت تُحفظ «9668 / ا ر ه» و«/ ا د ع 1355».
-- الأحرف فقط مفصولة بمسافات ثم الأرقام، و«هـ» حرف واحد، كما يفعل normalizePlate في src/lib/plates.ts.
-- اللوحة بلا أحرف عربية لا تُمس، ولا تُغيَّر لوحة لو تطابقت مع لوحة أخرى.
WITH src AS (
	SELECT id, translate(plate, '٠١٢٣٤٥٦٧٨٩', '0123456789') AS t FROM vehicles WHERE plate ~ '[ء-ي]'
), parts AS (
	SELECT id,
		regexp_replace(t, '[0-9[:space:]/\\|._,:;()-]', '', 'g') AS letters,
		regexp_replace(t, '[^0-9]', '', 'g') AS numbers
	FROM src
), fixed AS (
	SELECT id, concat_ws(' ', nullif(replace(array_to_string(regexp_split_to_array(letters, ''), ' '), ' ـ', 'ـ'), ''), nullif(numbers, '')) AS plate
	FROM parts
)
UPDATE vehicles v SET plate = f.plate
FROM fixed f
WHERE v.id = f.id AND f.plate <> '' AND v.plate <> f.plate
	AND NOT EXISTS (SELECT 1 FROM vehicles o WHERE o.id <> v.id AND o.plate = f.plate);
