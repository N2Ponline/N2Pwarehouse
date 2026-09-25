-- เปิด Supabase Realtime ให้ตาราง transactions — ทุกหน้าจอ StockMaster ที่เปิดอยู่จะอัปเดตยอดคงเหลือ/ประวัติเอง
-- ทันทีที่เครื่องอื่นทำรายการ (ทุกการเปลี่ยนสต็อกมีแถวใหม่ในตารางนี้เสมอ)
-- ไม่เปิดให้ products เพราะมีรูป base64 ฝังอยู่ ส่งผ่าน Realtime จะหนักเกิน — แอปดึงเฉพาะตัวเลขของสินค้าที่เปลี่ยนเอง
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'transactions') then
    alter publication supabase_realtime add table public.transactions;
  end if;
end $$;

-- ต้องเห็นแถว transactions ในผลลัพธ์นี้ ถึงจะใช้งานได้
select pubname, schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime';
