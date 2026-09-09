-- ══════════════════════════════════════════════════════════════════════
--  ตั้งค่าครั้งเดียว: เมนูย่อย "📋 บันทึกค้างส่ง" (ใต้แท็บ 🔍 เช็คสต็อก)
--  รันทั้งไฟล์นี้ใน Supabase → SQL Editor ของโปรเจกต์ slwbzbnomsugffyzjyuv
--  รันซ้ำได้ ไม่ทำลายข้อมูลเดิม (ใช้ if not exists / on conflict ทั้งหมด)
-- ══════════════════════════════════════════════════════════════════════

-- แถวเดียวคงที่ id=1 เก็บบันทึกทั้งชุดเป็น jsonb (ชื่อสินค้า/จำนวนค้างส่ง/สต็อก/รอเข้า/หมายเหตุ ต่อรายการ)
-- ให้ทุกเครื่อง/ทุกคนที่เข้า StockMaster เห็นบันทึกเดียวกัน ไม่ใช่แยกเก็บในเครื่องใครเครื่องมัน
create table if not exists public.backlog_notes (
  id bigint primary key default 1,
  items jsonb not null default '[]'::jsonb,   -- [{id,name,sku,myQty,stock,incQty,matched,note}]
  saved_at timestamptz,                        -- เวลาที่กดปุ่ม "บันทึก" ล่าสุด (แก้ไข/ลบทีละรายการไม่กระทบค่านี้)
  created_at timestamptz not null default now()
);

insert into public.backlog_notes (id, items) values (1, '[]'::jsonb) on conflict (id) do nothing;

-- ให้เว็บ (anon key) อ่าน/เขียนได้เหมือนตารางอื่นของ StockMaster
alter table public.backlog_notes enable row level security;
drop policy if exists "anon_all_backlog_notes" on public.backlog_notes;
create policy "anon_all_backlog_notes"
  on public.backlog_notes
  for all
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.backlog_notes to anon, authenticated;

-- ให้ PostgREST รู้จักตารางใหม่ทันที
notify pgrst, 'reload schema';

-- ตรวจผล (ควรเห็น 1 แถว id=1)
select * from public.backlog_notes;
