# محتسبي — Mohtaseby

نظام عروض الأسعار والموردين والحسابات لشركة IDEA / أياديا.

## التشغيل
1. `npm install`
2. انسخ `.env.example` إلى `.env` وضع بيانات مشروع Supabase
   (بدون `.env` يعمل البرنامج في وضع تجربة محلي على المتصفح)
3. شغّل `supabase/schema.sql` في Supabase SQL Editor
4. أنشئ Buckets في Storage: `company-assets`, `client-docs`, `receipt-docs` (كلها Private)
5. `npm run dev`

## الموديولات
- ✅ Module 1: إعدادات الشركة (لوجو / ليترهيد / ختم / إمضاء / حسابات بنكية)
- ⏳ Module 4: العملاء والموردين
- ⏳ Module 3: مكتبة البنود
- ⏳ Module 2: منشئ عروض الأسعار
- ⏳ Module 5: إيصال استلام نقدية
- ⏳ Module 6: التصدير PDF/Excel + نسخ Google Sheets الاحتياطي
