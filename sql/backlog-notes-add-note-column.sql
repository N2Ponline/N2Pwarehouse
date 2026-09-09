-- ══════════════════════════════════════════════════════════════════════
--  อัปเดตครั้งเดียว: เพิ่มช่อง "โน้ตถึงฝ่ายอื่น" (ข้อความเดียวอยู่บนสุดของหน้า ไม่ใช่ต่อรายการ)
--  รันในโปรเจกต์ slwbzbnomsugffyzjyuv → SQL Editor (ต้องรัน backlog-notes-setup.sql มาก่อนแล้ว)
--  รันซ้ำได้ ไม่ทำลายข้อมูลเดิม
-- ══════════════════════════════════════════════════════════════════════

alter table public.backlog_notes add column if not exists note text;

notify pgrst, 'reload schema';

select id, note, jsonb_array_length(items) as items_count, saved_at from public.backlog_notes;
