-- ================================================================
-- IDEA 360° — إصلاح صلاحيات الجداول (permission denied)
-- شغّله مرة واحدة في Supabase SQL Editor — آمن لإعادة التشغيل
-- ================================================================

-- منح الصلاحيات الكاملة على كل الجداول والتسلسلات الحالية
grant usage on schema public to anon, authenticated;
grant all privileges on all tables in schema public to anon, authenticated;
grant all privileges on all sequences in schema public to anon, authenticated;
grant all privileges on all functions in schema public to anon, authenticated;

-- وأي جداول تُنشأ مستقبلاً تاخد نفس الصلاحيات تلقائياً
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

-- إعادة تثبيت سياسات الوصول (بدون تسجيل دخول = anon)
do $$
declare t text;
begin
  foreach t in array array[
    'company_settings','clients','suppliers','categories','units',
    'equipment_library','equipment_suppliers','quotes','supplier_costs',
    'cash_receipts','receipt_attachments','recipients','preambles',
    'employees','tasks','expenses','incomes','venues','manual_taxes','backup_log'
  ] loop
    execute format('alter table if exists %I enable row level security;', t);
    execute format('drop policy if exists "auth all" on %I;', t);
    execute format('create policy "auth all" on %I for all to authenticated using (true) with check (true);', t);
    execute format('drop policy if exists "anon all" on %I;', t);
    execute format('create policy "anon all" on %I for all to anon using (true) with check (true);', t);
  end loop;
end $$;
