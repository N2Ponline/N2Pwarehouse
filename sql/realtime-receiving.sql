-- เปิด Supabase Realtime ให้ตารางรับเข้า/ใบสั่ง/จับคู่ชื่อ (ขั้นที่ 3 ยังไม่ได้ต่อในโค้ด — ตอนนี้แอปดึงใหม่ทุก 30 วิ + ตอนกลับมาที่แท็บแทน)
-- รันใน Supabase → SQL Editor ได้เลย รันซ้ำไม่พัง
do $$
declare t text;
begin
  foreach t in array array['receiving_logs','n2p_backlog','n2p_orders','incoming_aliases','product_aliases'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
