-- ══════════════════════════════════════════════════════════════════════
--  ตั้งค่าครั้งเดียว: "รับสินค้าเข้า" — ฝ่ายคลังบันทึกรับเข้าแทนใบพิมพ์กระดาษ
--  รันทั้งไฟล์นี้ใน Supabase → SQL Editor ของโปรเจกต์ slwbzbnomsugffyzjyuv
--  รันซ้ำได้ ไม่ทำลายข้อมูลเดิม (ใช้ if not exists ทั้งหมด)
--
--  ขั้นตอน: ฝ่ายคลังบันทึกที่นี่ก่อน (status='pending') ไม่กระทบสต็อกทันที
--  ผู้จัดการมาตรวจ/ยืนยันทีหลังในหน้า "เช็คสต็อก" ถึงจะเพิ่มเข้าสต็อกจริง (status='approved')
--  หรือเลือก "ไม่บันทึกลงคลัง" สำหรับของเบ็ดเตล็ดที่ไม่ใช่สต็อก (status='skipped')
--
--  ตั้งใจไม่เขียนกลับเข้า n2p_backlog (ตารางของระบบใบสั่ง n2p-order.netlify.app)
--  เพราะระบบนั้นมี sync 2 ทางระหว่าง n2p_orders/n2p_backlog ของตัวเอง (syncDocToBacklog/syncRoundToDoc)
--  เขียนตรงจากข้างนอกเสี่ยงชนกับ sync นั้นและทำข้อมูลเพี้ยน — ฝั่งระบบใบสั่งจะมาอ่านตารางนี้
--  (read-only) เพื่อโชว์ป้ายว่า "มีรับเข้าใน StockMaster แล้ว" แทน
-- ══════════════════════════════════════════════════════════════════════

create table if not exists public.receiving_logs (
  id bigint generated always as identity primary key,
  backlog_item_id bigint,              -- n2p_backlog.id ที่จับคู่ได้ตอนบันทึก (null ถ้าจับคู่ไม่ได้)
  backlog_item_name text,              -- ชื่อสินค้าตามระบบใบสั่ง ตอนบันทึก (เผื่อชื่อฝั่งนั้นเปลี่ยนทีหลัง)
  product_id bigint references public.products(id) on delete set null,
  product_name text,                   -- snapshot ชื่อสินค้าใน StockMaster ตอนบันทึก/อนุมัติ
  sku text,
  ordered_qty numeric,                 -- ยอดที่ยังรอเข้าตอนฝ่ายคลังบันทึก (อ้างอิงเทียบเฉยๆ ไม่บังคับตรง)
  received_qty numeric not null default 0,  -- จำนวนที่ฝ่ายคลังนับได้จริง (ผู้จัดการแก้ไขได้ก่อนยืนยัน)
  note text,
  received_by text,                    -- ชื่อฝ่ายคลังที่บันทึก
  status text not null default 'pending',   -- pending | approved | skipped
  approved_by text,                    -- ชื่อผู้จัดการที่ยืนยัน/ข้าม
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists receiving_logs_status_idx on public.receiving_logs (status);
create index if not exists receiving_logs_backlog_item_idx on public.receiving_logs (backlog_item_id);

alter table public.receiving_logs enable row level security;
drop policy if exists "anon_all_receiving_logs" on public.receiving_logs;
create policy "anon_all_receiving_logs"
  on public.receiving_logs
  for all
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.receiving_logs to anon, authenticated;
grant usage, select on sequence receiving_logs_id_seq to anon, authenticated;

notify pgrst, 'reload schema';

-- ตรวจผล (ควรรันแล้วไม่ error, ตารางว่างตอนแรก)
select * from public.receiving_logs limit 5;
