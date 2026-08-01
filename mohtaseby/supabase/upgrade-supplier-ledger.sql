-- ================================================================
-- IDEA 360° — صلاحيات كشف حساب الموردين وبنودهم
-- شغّله مرة واحدة في Supabase → SQL Editor — آمن لإعادة التشغيل
-- ================================================================

-- ---- 1) صلاحيات جديدة على مستوى الموظف ----
alter table employees
  add column if not exists can_view_supplier_ledger boolean default false,
  add column if not exists can_view_supplier_prices boolean default false,
  -- all = يشوف كل الموردين | selected = الموردين المختارين له فقط
  add column if not exists supplier_scope text default 'all';

-- ---- 2) ربط الموظف بموردين محددين ----
create table if not exists employee_suppliers (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete cascade,
  created_at  timestamptz default now(),
  unique (employee_id, supplier_id)
);

create index if not exists employee_suppliers_emp_idx on employee_suppliers(employee_id);

-- ---- 3) الصلاحيات ----
grant usage on schema public to anon, authenticated;
grant all privileges on all tables    in schema public to anon, authenticated;
grant usage, select, update on all sequences in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables    to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

alter table employee_suppliers enable row level security;
drop policy if exists "anon all" on employee_suppliers;
create policy "anon all" on employee_suppliers for all to anon using (true) with check (true);
drop policy if exists "auth all" on employee_suppliers;
create policy "auth all" on employee_suppliers for all to authenticated using (true) with check (true);
