-- ══════════════════════════════════════════════════════════════════════
--  อัปเดตครั้งเดียว: เพิ่มคอลัมน์อ้างอิง "ใบสั่งซื้อ" ให้ receiving_logs
--  รันในโปรเจกต์ slwbzbnomsugffyzjyuv → SQL Editor (ต้องรัน receiving-logs-setup.sql มาก่อนแล้ว)
--  รันซ้ำได้ ไม่ทำลายข้อมูลเดิม
--
--  เหตุผล: ของรอเข้า 1 สินค้าอาจมาจากหลายใบสั่งซื้อพร้อมกัน (คนละรอบสั่ง) เดิมหน้า
--  "รับสินค้าเข้า" รวมยอดรอรับทุกใบเข้าด้วยกันเป็นก้อนเดียว ทำให้ไม่รู้ว่าของที่รับมา
--  ตรงกับใบสั่งซื้อใบไหน — เปลี่ยนให้ทำงานต่อ "ใบสั่งซื้อ" แทน ต้องเก็บอ้างอิงใบไว้ด้วย
-- ══════════════════════════════════════════════════════════════════════

alter table public.receiving_logs add column if not exists doc_id bigint;      -- n2p_orders.id ของใบสั่งซื้อที่รับเข้า
alter table public.receiving_logs add column if not exists doc_no text;        -- เลขที่ใบสั่งซื้อ เช่น ORD-202609-826 (ไว้โชว์ในหน้าอนุมัติ)
alter table public.receiving_logs add column if not exists backlog_round_id bigint; -- รอบสั่งใน n2p_backlog.rounds ที่ item นี้ผูกอยู่ (กันนับซ้ำ)

create index if not exists receiving_logs_doc_idx on public.receiving_logs (doc_id);

notify pgrst, 'reload schema';

select id, doc_id, doc_no, backlog_round_id from public.receiving_logs limit 5;
