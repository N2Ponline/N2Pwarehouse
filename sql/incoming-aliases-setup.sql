-- ══════════════════════════════════════════════════════════════════════
--  ตั้งค่าครั้งเดียว: "การจับคู่ชื่อของรอเข้าเอง" (หน้าต่าง 🧾 ของรอเข้า ในคลังสินค้า)
--  รันทั้งไฟล์นี้ใน Supabase → SQL Editor ของโปรเจกต์ slwbzbnomsugffyzjyuv
--  รันซ้ำได้ ไม่ทำลายข้อมูลเดิม (ใช้ if not exists ทั้งหมด)
--
--  เดิมการจับคู่เองที่หน้า "🧾 ของรอเข้า" เก็บไว้ใน localStorage ของเบราว์เซอร์
--  แต่ละเครื่องเลยเห็นการแก้ไม่ตรงกัน (คนละคนแก้บนคนละเครื่อง คนอื่นไม่เห็น) —
--  ย้ายมาเก็บในตารางนี้แทน ให้ทุกเครื่อง/ทุกคนเห็นตรงกัน
--
--  แถวหนึ่ง = ชื่อสินค้าหนึ่งชื่อ (ตามระบบใบสั่ง n2p_backlog.name) จับคู่กับสินค้าในคลังตัวไหน
--  product_id = null หมายถึง "ตั้งเองว่าไม่ต้องจับคู่เลย" (ไม่ใช่ปล่อยให้ระบบเดา)
--  ไม่มีแถวเลย = ยังไม่ได้ตั้งเอง ปล่อยให้ระบบเดาอัตโนมัติตามปกติ
-- ══════════════════════════════════════════════════════════════════════

create table if not exists public.incoming_aliases (
  name text primary key,               -- ชื่อสินค้าตามระบบใบสั่ง (n2p_backlog.name) เป๊ะๆ
  product_id bigint references public.products(id) on delete set null,  -- null = ตั้งเองว่าไม่จับคู่
  updated_by text,                     -- ใครเป็นคนแก้ล่าสุด (ถ้ามี)
  updated_at timestamptz not null default now()
);

alter table public.incoming_aliases enable row level security;
drop policy if exists "anon_all_incoming_aliases" on public.incoming_aliases;
create policy "anon_all_incoming_aliases"
  on public.incoming_aliases
  for all
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.incoming_aliases to anon, authenticated;

notify pgrst, 'reload schema';

-- ตรวจผล (ควรรันแล้วไม่ error, ตารางว่างตอนแรก)
select * from public.incoming_aliases limit 5;
