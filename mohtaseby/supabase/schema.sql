-- ================================================================
-- IDEA 360° — IDEA-EG | OS v3.5 — Database Schema
-- ================================================================
-- ✅ آمن لإعادة التشغيل: يشتغل على قاعدة جديدة فاضية أو على قاعدة
--    شغالة بالفعل — من غير ما يمسح أو يغيّر أي بيانات موجودة.
-- Supabase → SQL Editor → New query → الصق كل المحتوى → Run
-- ================================================================

-- ============ الإعدادات والهوية ============
create table if not exists company_settings (
  id uuid primary key default gen_random_uuid(),
  company_name text, address text, tax_id text, commercial_reg_no text,
  logo_url text, letterhead_url text, stamp_url text, signature_url text,
  bank_accounts jsonb default '[]'::jsonb,
  default_stamp boolean default false,
  default_signature boolean default false,
  telegram_bot_token text,
  google_script_url text,
  show_alerts_ticker boolean default true,
  send_via_telegram boolean default true,
  send_via_whatsapp boolean default false,
  whatsapp_api_token text,
  whatsapp_phone_id text,
  admin_password text default '',
  updated_at timestamptz default now()
);

-- ============ المستخدمون والصلاحيات ============
create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token text unique not null,
  password text default '',
  employee_id uuid,
  allowed_pages jsonb default '[]'::jsonb,
  is_admin boolean default false,
  created_at timestamptz default now()
);

-- ============ العملاء والموردون ============
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  company_name text not null, contact_person text, phone text, email text, address text,
  commercial_reg_no text, tax_card_no text, cr_image_url text, tax_card_image_url text,
  created_at timestamptz default now()
);

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null, company_name text,
  category text, categories jsonb default '[]'::jsonb, extra_categories jsonb default '[]'::jsonb,
  adds_tax boolean default false, tax_rate numeric default 14,
  payment_method text, account_number text,
  sub_items jsonb default '[]'::jsonb,
  phones jsonb default '[]'::jsonb,
  phone text default '',
  payment_accounts jsonb default '[]'::jsonb,
  address text default '', location_url text default '',
  telegram_chat_id text default '', whatsapp_number text default '',
  public_token text default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz default now()
);

-- ============ مكتبة البنود (أساسي وفرعي) ============
create table if not exists library_main (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table if not exists library_sub (
  id uuid primary key default gen_random_uuid(),
  main_id uuid references library_main(id) on delete cascade,
  name text not null,
  unit text default 'باليوم',
  client_price numeric default 0,
  notes text default '',
  created_at timestamptz default now()
);

create table if not exists sub_supplier_prices (
  id uuid primary key default gen_random_uuid(),
  sub_id uuid references library_sub(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete cascade,
  cost_price numeric default 0
);

create table if not exists supplier_main_items (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete cascade,
  main_id uuid references library_main(id) on delete cascade
);

-- مكتبة قديمة (متوافقة مع كود الترحيل التاريخي، لا تُستخدم في الواجهة الحالية)
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null, name_en text, created_at timestamptz default now()
);
create table if not exists units (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null, name_en text, created_at timestamptz default now()
);
create table if not exists equipment_library (
  id uuid primary key default gen_random_uuid(),
  item_name text, category text, default_unit text,
  cost_price numeric default 0, notes text,
  created_at timestamptz default now()
);
create table if not exists equipment_suppliers (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid references equipment_library(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete cascade,
  cost_price numeric default 0,
  created_at timestamptz default now()
);

-- ============ الأماكن والقاعات ============
create table if not exists venues (
  id uuid primary key default gen_random_uuid(),
  governorate text, hotel_name text not null, hall_name text, floor_no text,
  address text, location_url text,
  max_height numeric, max_width numeric, dimensions text,
  contacts jsonb default '[]'::jsonb,
  halls jsonb default '[]'::jsonb,
  notes text,
  created_at timestamptz default now()
);

-- ============ المؤتمرات ============
create table if not exists conferences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  date_from date, date_to date,
  governorate text,
  venue_id uuid references venues(id) on delete set null,
  hall_name text,
  location text,
  agenda_url text,
  notes text default '',
  created_at timestamptz default now()
);

-- ============ عروض الأسعار والفواتير ============
create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  conference_id uuid references conferences(id) on delete set null,
  conference_name text, date_from date, date_to date, location text,
  is_taxable boolean default true,
  subtotal numeric default 0, wht_amount numeric default 0,
  vat_amount numeric default 0, grand_total numeric default 0,
  include_stamp boolean default false, include_signature boolean default false,
  doc_type text default 'proposal',
  preamble text,
  payments jsonb default '[]'::jsonb,
  finished boolean default false,
  tax_filed boolean default false, tax_paid boolean default false,
  einvoice_done boolean default false,
  snooze_until date,
  show_notes boolean default true,
  show_org boolean default true,
  beneficiary text default '',
  preparing boolean default false,
  tested_suppliers jsonb default '{}'::jsonb,
  work_order_suppliers jsonb default '[]'::jsonb,
  show_countdown boolean default true,
  status text default 'draft',
  data jsonb,
  created_at timestamptz default now()
);

-- ============ تكاليف الموردين (نظام قديم، محفوظ للتوافق) ============
create table if not exists supplier_costs (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete set null,
  category text, item_name text, cost_date date, conference_name text,
  quantity numeric default 0, price numeric default 0,
  num_days numeric default 1, num_halls numeric default 1,
  payment_1 numeric default 0, payment_2 numeric default 0, payment_3 numeric default 0,
  location text,
  created_at timestamptz default now()
);

-- ============ فواتير الموردين وسجلهم المالي ============
create table if not exists supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete cascade,
  conference_id uuid references conferences(id) on delete set null,
  invoice_date date default current_date,
  is_taxable boolean default false,
  items jsonb default '[]'::jsonb,
  payments jsonb default '[]'::jsonb,
  temp_supplier text default '',
  free_conference text default '',
  notes text default '',
  created_at timestamptz default now()
);

create table if not exists supplier_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete cascade,
  conference_id uuid references conferences(id) on delete set null,
  amount numeric default 0,
  pay_date date default current_date,
  method text default 'cash',
  note text default '',
  created_at timestamptz default now()
);

create table if not exists supplier_adjustments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete cascade,
  amount numeric default 0,
  reason text default '',
  adj_date date default current_date,
  created_at timestamptz default now()
);

-- ============ الإيصالات ============
create sequence if not exists receipt_number_seq start 1;
create table if not exists cash_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number int not null default nextval('receipt_number_seq'),
  client_id uuid references clients(id) on delete set null,
  supplier_id uuid references suppliers(id) on delete set null,
  recipient_id uuid,
  payer_name text, recipient_name text,
  amount_egp numeric default 0, amount_piasters numeric default 0,
  amount_in_words text,
  payment_type text default 'نقداً', cheque_number text,
  purpose text, receipt_date date default current_date,
  include_stamp boolean default false, include_signature boolean default false,
  created_at timestamptz default now()
);

create table if not exists receipt_attachments (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid references cash_receipts(id) on delete cascade,
  file_url text, file_type text,
  created_at timestamptz default now()
);

-- ============ المستلمون والدباجات ============
create table if not exists recipients (
  id uuid primary key default gen_random_uuid(),
  name text not null, phone text, company text default '', job_title text default '',
  telegram_chat_id text default '', whatsapp_number text default '',
  created_at timestamptz default now()
);

create table if not exists preambles (
  id uuid primary key default gen_random_uuid(),
  title text, body text, created_at timestamptz default now()
);

-- ============ الموظفون والمهام ============
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  name text default '',
  phone text default '',
  phones jsonb default '[]'::jsonb,
  emp_type text default 'permanent',
  quote_id uuid references quotes(id) on delete set null,
  job_title text default '',
  payment_method text, account_number text,
  telegram_chat_id text default '', whatsapp_number text default '',
  access_token text default replace(gen_random_uuid()::text,'-',''),
  allowed_pages jsonb default '[]'::jsonb,
  access_password text default '',
  created_at timestamptz default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid references quotes(id) on delete cascade,
  title text default '', note text default '', done boolean default false,
  employee_id uuid references employees(id) on delete set null,
  created_at timestamptz default now()
);

-- ============ الخزنة: المصروفات والتحصيل ============
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  expense_type text default 'general',
  quote_id uuid references quotes(id) on delete set null,
  conference_id uuid references conferences(id) on delete set null,
  recipient_employee_id uuid references employees(id) on delete set null,
  handed_to uuid references employees(id) on delete set null,
  name text default '', amount numeric default 0,
  expense_date date default current_date, notes text default '',
  created_at timestamptz default now()
);

create table if not exists incomes (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid references quotes(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  amount numeric default 0, income_date date default current_date,
  notes text default '',
  created_at timestamptz default now()
);

-- ============ الضرائب اليدوية ============
create table if not exists manual_taxes (
  id uuid primary key default gen_random_uuid(),
  conference_name text default '', client_name text default '',
  client_id uuid references clients(id) on delete set null,
  invoice_date date,
  subtotal numeric default 0, wht_amount numeric default 0,
  vat_amount numeric default 0, grand_total numeric default 0,
  tax_filed boolean default false, tax_paid boolean default false,
  snooze_until date,
  notes text default '',
  created_at timestamptz default now()
);

-- ============ المخزن: أصناف وقطع وحركات ============
create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  item_type text default 'unit',
  unit_label text default 'قطعة',
  length_balance numeric default 0,
  notes text default '',
  created_at timestamptz default now()
);

create table if not exists inventory_units (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references inventory_items(id) on delete cascade,
  barcode text unique not null,
  serial text default '',
  status text default 'available',
  conference_id uuid references conferences(id) on delete set null,
  permit_id uuid,
  qty integer default 1,
  length_m numeric,
  condition text default 'new',
  lost_or_damaged boolean default false,
  brand text default '',
  source text default '',
  purchase_date date,
  specs jsonb default '[]'::jsonb,
  notes text default '',
  created_at timestamptz default now()
);

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references inventory_items(id) on delete cascade,
  unit_id uuid references inventory_units(id) on delete set null,
  conference_id uuid references conferences(id) on delete set null,
  movement text not null,
  qty numeric default 1,
  mv_date date default current_date,
  notes text default '',
  created_at timestamptz default now()
);

-- ============ أذون الخروج ============
create sequence if not exists permit_number_seq start 1;
create table if not exists exit_permits (
  id uuid primary key default gen_random_uuid(),
  permit_number int not null default nextval('permit_number_seq'),
  recipient_id uuid references recipients(id) on delete set null,
  recipient_name text default '', recipient_phone text default '',
  recipient_company text default '', recipient_job text default '',
  exit_type text default 'conference',
  conference_id uuid references conferences(id) on delete set null,
  employee_id uuid references employees(id) on delete set null,
  exit_date date default current_date,
  expected_return date,
  due_date date,
  unit_ids jsonb default '[]'::jsonb,
  returned_ids jsonb default '[]'::jsonb,
  item_notes jsonb default '{}'::jsonb,
  tested_status text default 'not_tested',
  status text default 'open',
  notes text default '',
  created_at timestamptz default now()
);

do $$
begin
  alter table inventory_units add constraint inventory_units_permit_id_fkey
    foreign key (permit_id) references exit_permits(id) on delete set null;
exception when duplicate_object then null;
end $$;

-- ============ سجل النسخ الاحتياطي ============
create table if not exists backup_log (
  id uuid primary key default gen_random_uuid(),
  status text, sheet_url text, created_at timestamptz default now()
);

-- ================================================================
-- الصلاحيات: وصول كامل لكل الجداول (وضع بدون تسجيل دخول للتجربة)
-- عند تفعيل نظام الدخول لاحقاً، احذف سياسات "anon all" من هنا
-- ================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'company_settings','app_users','clients','suppliers',
    'library_main','library_sub','sub_supplier_prices','supplier_main_items',
    'categories','units','equipment_library','equipment_suppliers',
    'venues','conferences','quotes','supplier_costs',
    'supplier_invoices','supplier_payments','supplier_adjustments',
    'cash_receipts','receipt_attachments','recipients','preambles',
    'employees','tasks','expenses','incomes','manual_taxes',
    'inventory_items','inventory_units','stock_movements','exit_permits',
    'backup_log'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "auth all" on %I;', t);
    execute format('create policy "auth all" on %I for all to authenticated using (true) with check (true);', t);
    execute format('drop policy if exists "anon all" on %I;', t);
    execute format('create policy "anon all" on %I for all to anon using (true) with check (true);', t);
    execute format('grant all privileges on table %I to anon, authenticated;', t);
  end loop;
end $$;

grant usage on schema public to anon, authenticated;
grant all privileges on all sequences in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

-- ============ مخازن الملفات (Storage Buckets) ============
insert into storage.buckets (id, name, public)
values
  ('company-assets', 'company-assets', false),
  ('client-docs',    'client-docs',    false),
  ('receipt-docs',   'receipt-docs',   false)
on conflict (id) do nothing;

do $$
declare op text;
begin
  foreach op in array array['select','insert','update','delete']
  loop
    execute format(
      'drop policy if exists "idea360 %s" on storage.objects;', op
    );
    execute format(
      'create policy "idea360 %s" on storage.objects for %s to anon, authenticated %s (bucket_id in (''company-assets'',''client-docs'',''receipt-docs''));',
      op, op,
      case when op = 'insert' then 'with check' else 'using' end
    );
  end loop;
end $$;

-- ============ البيانات الافتراضية ============
insert into categories (name_ar, name_en)
select * from (values
 ('شاشات','Screens'),('ستيدج','Stage'),('صوت','Audio'),('تصوير','Photo & Video'),
 ('لوجيستيات','Logistics'),('ديكور','Decor'),('مطبوعات','Prints')) v(a,b)
where not exists (select 1 from categories);

insert into units (name_ar, name_en)
select * from (values
 ('باليوم','Per day'),('بالمتر','Per meter'),('بالقطعة','Per piece'),('بالساعة','Per hour')) v(a,b)
where not exists (select 1 from units);

-- ================================================================
-- انتهى. البرنامج جاهز للعمل فوراً على هذا المشروع.
-- ================================================================

-- ============ v3.2 ============
alter table sub_supplier_prices add column if not exists sell_price numeric default 0;  -- سعر البيع الخاص بهذا المورد لهذا البند (منفصل عن سعر التكلفة)

-- ============ v3.4 ============
alter table company_settings add column if not exists show_upcoming_widget boolean default true;  -- سويتش الأدمن لإظهار مفتاح "أقرب معاد" للموظفين

-- ================================================================
-- ============ v3.5: أوامر الشغل + مزايا تليجرام ============
-- ================================================================
-- آمن لإعادة التشغيل. شغّل الملف كله أو هذا القسم وحده.
-- ================================================================

-- ---- 1) ربط تليجرام: استكمال الناقص ----
alter table app_users  add column if not exists telegram_chat_id text default '';
alter table suppliers  add column if not exists telegram_chat_id text default '';
alter table employees  add column if not exists telegram_linked_at timestamptz;
alter table app_users  add column if not exists telegram_linked_at timestamptz;
alter table suppliers  add column if not exists telegram_linked_at timestamptz;
alter table recipients add column if not exists telegram_linked_at timestamptz;

-- يوزر البوت — مطلوب لبناء روابط الدعوة من داخل البرنامج
alter table company_settings add column if not exists telegram_bot_username text default '';

-- ---- 2) صلاحيات الحسابات والمصاريف على البوت ----
alter table employees add column if not exists can_view_finance boolean default false;
alter table employees add column if not exists can_log_expense  boolean default false;

-- ---- 3) أوامر الشغل ----
create sequence if not exists work_order_number_seq start 1;

create table if not exists work_orders (
  id            uuid primary key default gen_random_uuid(),
  wo_number     int not null default nextval('work_order_number_seq'),
  order_key     text unique not null default upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),
  title         text default '',
  conference_id uuid references conferences(id) on delete set null,
  quote_id      uuid references quotes(id)      on delete set null,
  client_id     uuid references clients(id)     on delete set null,
  employee_id   uuid references employees(id)   on delete set null,  -- الموظف المسند له
  supplier_id   uuid references suppliers(id)   on delete set null,
  venue_id      uuid references venues(id)      on delete set null,
  location      text default '',
  date_from     date,
  date_to       date,
  setup_time    text default '',              -- ميعاد التجهيز
  start_time    text default '',              -- ميعاد بداية الشغل
  contacts      jsonb default '[]'::jsonb,    -- [{name, phone, role}]
  notes         text default '',
  status        text default 'open',          -- open | in_progress | done | cancelled
  sent_at       timestamptz,                  -- اتبعت لتليجرام إمتى
  created_at    timestamptz default now()
);

create table if not exists work_order_items (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid references work_orders(id) on delete cascade,
  sub_id        uuid references library_sub(id) on delete set null,
  item_name     text default '',
  qty           numeric default 1,
  unit          text default 'قطعة',
  days          numeric default 1,
  note          text default '',
  done          boolean default false,
  sort_order    int default 0,
  created_at    timestamptz default now()
);
create index if not exists idx_woi_order   on work_order_items(work_order_id);
create index if not exists idx_wo_employee on work_orders(employee_id);

-- ---- 4) دعوات تليجرام بلينك ----
create table if not exists telegram_invites (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null default replace(gen_random_uuid()::text,'-',''),
  target_type text not null,                  -- employee | supplier | recipient | app_user
  target_id   uuid,
  name        text default '',
  phone       text default '',
  used        boolean default false,
  used_at     timestamptz,
  chat_id     text default '',
  created_at  timestamptz default now()
);
create index if not exists idx_inv_code on telegram_invites(code);

-- ---- 5) المصاريف من البوت ----
alter table expenses add column if not exists source            text default 'app';  -- app | telegram
alter table expenses add column if not exists created_by_emp_id uuid references employees(id) on delete set null;
alter table expenses add column if not exists work_order_id     uuid references work_orders(id) on delete set null;

-- ---- 6) المهام: الإنجاز من البوت ----
alter table tasks add column if not exists completed_via_bot boolean default false;
alter table tasks add column if not exists completed_at      timestamptz;

-- ---- 7) ذاكرة محادثة البوت (Cloudflare Worker بلا حالة) ----
create table if not exists bot_state (
  chat_id    text primary key,
  state      text default '',
  data       jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- ---- 8) أعمدة ناقصة يستخدمها البرنامج فعلياً ----
alter table exit_permits    add column if not exists partial_qty   jsonb default '{}'::jsonb;
alter table inventory_items add column if not exists specs         text  default '';   -- مواصفات حرة للصنف
alter table inventory_units add column if not exists damage_reason text  default '';   -- سبب التلف

-- ---- 9) RLS + الصلاحيات للجداول الجديدة ----
do $$
declare t text;
begin
  foreach t in array array['work_orders','work_order_items','telegram_invites','bot_state']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "auth all" on %I;', t);
    execute format('create policy "auth all" on %I for all to authenticated using (true) with check (true);', t);
    execute format('drop policy if exists "anon all" on %I;', t);
    execute format('create policy "anon all" on %I for all to anon using (true) with check (true);', t);
    execute format('grant all privileges on table %I to anon, authenticated;', t);
  end loop;
end $$;

grant all privileges on all sequences in schema public to anon, authenticated;

NOTIFY pgrst, 'reload schema';
