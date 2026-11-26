-- ══════════════════════════════════════════════════════════════════════
--  ตั้งค่าครั้งเดียว: PIN พนักงาน + เช็คพัสดุซ้ำข้ามใบหยิบ
--  (StockMaster หน้า 🎯 ยิงตัดสต๊อก + MyOrder extension v3.12)
--  รันทั้งไฟล์ใน Supabase → SQL Editor ของโปรเจกต์ slwbzbnomsugffyzjyuv
--  รันซ้ำได้ ไม่ทำลายข้อมูลเดิม
-- ══════════════════════════════════════════════════════════════════════

-- 1) รายชื่อพนักงาน + PIN (เก็บเป็น hash, เว็บ/extension อ่านตารางนี้ตรงๆ ไม่ได้ — ต้องผ่านฟังก์ชันด้านล่างเท่านั้น)
create table if not exists public.staff_pins (
  id         bigserial primary key,
  name       text not null,
  pin_hash   text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists staff_pins_active_pin_uq on public.staff_pins (pin_hash) where active;
create unique index if not exists staff_pins_name_uq on public.staff_pins (lower(name));
alter table public.staff_pins enable row level security;   -- ไม่มี policy = anon อ่าน/เขียนตรงไม่ได้

-- 2) รหัสผู้จัดการ (ใช้รหัสเดียวกับที่ล็อกหน้าคลังอยู่แล้ว) — เก็บฝั่ง server ไว้เช็คตอนจัดการ PIN / อนุมัติพิมพ์ซ้ำ
create table if not exists public.app_private_settings (
  key   text primary key,
  value text not null
);
alter table public.app_private_settings enable row level security;
insert into public.app_private_settings (key, value) values ('manager_password', '168168')
  on conflict (key) do nothing;

-- 3) คอลัมน์ใหม่ในใบหยิบ
alter table public.order_scans
  add column if not exists printed_by  text,    -- ใครพิมพ์ใบหยิบ (PIN ใน extension)
  add column if not exists dup_parcels jsonb,   -- พัสดุที่ผู้จัดการอนุมัติให้พิมพ์ซ้ำ [{tracking, pick_id}]
  add column if not exists opened_by   text,    -- ใครยิงเปิดใบใน StockMaster
  add column if not exists closed_by   text,    -- ใครกดปิดใบ (= คนตัดสต็อก)
  add column if not exists pick_people jsonb;   -- ใครยิงกี่ชิ้น {"เก๋": 12, "แตน": 3}

-- ── ฟังก์ชัน ──────────────────────────────────────────────────────────
create or replace function public.staff_pin_hash(p_pin text) returns text
language sql immutable as $$ select encode(sha256(convert_to('n2p-staff:' || trim(p_pin), 'UTF8')), 'hex') $$;

create or replace function public.manager_check(p_pw text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_private_settings where key = 'manager_password' and value = p_pw)
$$;

-- ใส่ PIN → ได้ชื่อพนักงาน (null = PIN ผิด)
create or replace function public.staff_verify_pin(p_pin text) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if p_pin is null or trim(p_pin) !~ '^\d{4,6}$' then return null; end if;
  return (select name from staff_pins where active and pin_hash = staff_pin_hash(p_pin) limit 1);
end $$;

create or replace function public.staff_admin_list(p_pw text)
returns table (id bigint, name text, active boolean, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not manager_check(p_pw) then raise exception 'รหัสผู้จัดการไม่ถูกต้อง'; end if;
  return query select s.id, s.name, s.active, s.updated_at from staff_pins s order by s.active desc, s.name;
end $$;

-- เพิ่ม (p_id null) / แก้ชื่อ / เปลี่ยน PIN (p_pin null = ไม่เปลี่ยน) / เปิด-ปิดการใช้งาน
create or replace function public.staff_admin_save(p_pw text, p_id bigint, p_name text, p_pin text, p_active boolean)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_hash text;
begin
  if not manager_check(p_pw) then raise exception 'รหัสผู้จัดการไม่ถูกต้อง'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'กรุณาใส่ชื่อพนักงาน'; end if;
  if p_pin is not null and trim(p_pin) !~ '^\d{4,6}$' then raise exception 'PIN ต้องเป็นตัวเลข 4-6 หลัก'; end if;
  v_hash := case when p_pin is null then null else staff_pin_hash(p_pin) end;
  if v_hash is not null and exists (select 1 from staff_pins where active and pin_hash = v_hash and id is distinct from p_id) then
    raise exception 'PIN นี้มีคนใช้แล้ว เลือก PIN อื่น';
  end if;
  if p_id is null then
    if v_hash is null then raise exception 'กรุณาตั้ง PIN'; end if;
    insert into staff_pins (name, pin_hash, active) values (trim(p_name), v_hash, coalesce(p_active, true)) returning id into v_id;
  else
    update staff_pins set name = trim(p_name), pin_hash = coalesce(v_hash, pin_hash), active = coalesce(p_active, active), updated_at = now()
      where id = p_id returning id into v_id;
    if v_id is null then raise exception 'ไม่พบพนักงาน'; end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'ชื่อหรือ PIN ซ้ำกับคนอื่น';
end $$;

-- พัสดุที่เคยอยู่ในใบหยิบอื่นแล้ว (ย้อนหลัง 90 วัน) — เทียบด้วยเลขพัสดุ ตัดคำ CANCEL ท้ายเลขที่ extension เก่าดึงติดมา
create or replace function public.pick_dup_parcels(p_trackings text[], p_exclude_id bigint default null)
returns table (tracking text, pick_id bigint, created_at timestamptz, page_name text, pick_status text, printed_by text, closed_by text, picked_by text)
language sql stable set search_path = public as $$
  with want as (
    select distinct upper(regexp_replace(trim(t), 'CANCEL$', '', 'i')) as trk from unnest(p_trackings) t where coalesce(trim(t), '') <> ''
  )
  select w.trk, s.id, s.created_at, s.page_name, s.pick_status, s.printed_by, s.closed_by, s.picked_by
  from order_scans s
  cross join lateral jsonb_array_elements(case when jsonb_typeof(s.parcels) = 'array' then s.parcels else '[]'::jsonb end) p
  join want w on w.trk = upper(regexp_replace(coalesce(p->>'tracking', ''), 'CANCEL$', '', 'i'))
  where s.created_at >= now() - interval '90 days'
    and (p_exclude_id is null or s.id <> p_exclude_id)
  order by s.id
$$;

grant execute on function public.staff_verify_pin(text) to anon, authenticated;
grant execute on function public.manager_check(text) to anon, authenticated;
grant execute on function public.staff_admin_list(text) to anon, authenticated;
grant execute on function public.staff_admin_save(text, bigint, text, text, boolean) to anon, authenticated;
grant execute on function public.pick_dup_parcels(text[], bigint) to anon, authenticated;
revoke execute on function public.staff_pin_hash(text) from anon, authenticated, public;

-- เช็คผล
select 'staff_pins' as t, count(*) from public.staff_pins
union all select 'order_scans new cols', count(*) from information_schema.columns
  where table_schema = 'public' and table_name = 'order_scans' and column_name in ('printed_by','dup_parcels','opened_by','closed_by','pick_people');
