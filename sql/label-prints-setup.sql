-- ══════════════════════════════════════════════════════════════════════
--  ตั้งค่าครั้งเดียว: log การพิมพ์ใบปะหน้า (ใบส่งของ) จาก MyOrder
--  extension v3.13 ดักปุ่ม "③ พิมพ์ใบส่งของ" แล้วบันทึกที่นี่ · หน้า StockMaster › เช็คสต็อก › 📜 Log ใบหยิบ อ่านไปโชว์
--  รันทั้งไฟล์ใน Supabase → SQL Editor ของโปรเจกต์ slwbzbnomsugffyzjyuv (รันซ้ำได้)
-- ══════════════════════════════════════════════════════════════════════

create table if not exists public.label_prints (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  batch_id    text,          -- กดพิมพ์ 1 ครั้ง = 1 batch (หลายพัสดุ)
  order_id    text,          -- id ภายในของ MyOrder (24 ตัว)
  order_no    text,          -- เลขคำสั่งซื้อที่โชว์ในตาราง
  tracking    text,          -- เลขพัสดุ (ตัด CANCEL แล้ว)
  page_name   text,
  pick_id     bigint,        -- ใบหยิบ PK ที่มีพัสดุนี้ (ใบล่าสุด) — null = ไม่ได้ผ่านใบหยิบ
  printed_by  text,          -- ชื่อจาก PIN
  reprint     boolean not null default false,  -- เคยพิมพ์ใบปะหน้าแล้ว (จาก log เรา หรือ MyOrder บอกว่าพิมพ์แล้ว)
  no_pick     boolean not null default false,  -- พิมพ์ทั้งที่ยังไม่มีใบหยิบ
  approved    text           -- ผู้จัดการอนุมัติ (กรณี reprint / no_pick)
);
create index if not exists label_prints_tracking_idx on public.label_prints (tracking);
create index if not exists label_prints_created_idx on public.label_prints (created_at desc);

alter table public.label_prints enable row level security;
drop policy if exists "anon_read_label_prints" on public.label_prints;
create policy "anon_read_label_prints" on public.label_prints for select to anon, authenticated using (true);
drop policy if exists "anon_insert_label_prints" on public.label_prints;
create policy "anon_insert_label_prints" on public.label_prints for insert to anon, authenticated with check (true);
-- ไม่มี policy update/delete = แก้/ลบ log จากเว็บไม่ได้

select 'label_prints' as t, count(*) from public.label_prints;
