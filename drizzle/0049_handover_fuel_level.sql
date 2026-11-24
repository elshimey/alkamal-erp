-- مستوى الوقود «ثلاثة أرباع» يُحفظ three_quarters (14 حرفاً) والخانة كانت 12، فكان حفظ المحضر يفشل.
ALTER TABLE "vehicle_handovers" ALTER COLUMN "fuel_level" TYPE varchar(20);
