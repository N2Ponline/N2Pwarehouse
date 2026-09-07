-- ══════════════════════════════════════════════════════════════════════
--  ตั้งค่าครั้งเดียว: "ยิงตัดสต๊อกจากใบหยิบ" (StockMaster ↔ MyOrder extension v3.8)
--  รันทั้งไฟล์นี้ใน Supabase → SQL Editor ของโปรเจกต์ slwbzbnomsugffyzjyuv
--  รันซ้ำได้ ไม่ทำลายข้อมูลเดิม (ใช้ if not exists ทั้งหมด)
-- ══════════════════════════════════════════════════════════════════════

-- 1) order_scans = ใบหยิบ (extension สร้างแถวตอนพิมพ์สลิป, บาร์โค้ดบนสลิป = "PK" + id)
--    เพิ่มคอลัมน์เก็บความคืบหน้าการยิง
alter table public.order_scans
  add column if not exists pick_status    text,        -- null = ยังไม่เริ่ม | 'picking' = กำลังยิง | 'closed' = ปิดใบแล้ว (กดยืนยันเอง)
  add column if not exists pick_progress  jsonb,       -- {"<product_id>": {"scanned": 3, "short": 1}, ...}  นับเป็นชิ้นราย SKU
  add column if not exists picked_by      text,        -- ชื่อพนักงานที่ยิง
  add column if not exists pick_closed_at timestamptz; -- เวลาปิดใบ

create index if not exists order_scans_pick_status_idx on public.order_scans (pick_status, created_at desc);

-- 2) product_aliases = จำว่า "ชื่อสินค้าตาม myorder" (รวมชื่อโปร) ขาย 1 หน่วย = ต้องตัดสินค้าอะไรในคลัง กี่ชิ้น
--    components = [{"product_id": 45, "qty": 7}]            ← "แปรงหินภูเขาไฟ RingX(6 แพค ฟรี 1 แพค)" = แปรงหิน 7 ชิ้น
--                 [{"product_id": 45, "qty": 1}, {"product_id": 52, "qty": 1}]  ← เซ็ตที่มีหลาย SKU
--                 []                                         ← ชื่อนี้ไม่มีในคลัง ไม่ต้องตัดสต็อก
create table if not exists public.product_aliases (
  myorder_name text primary key,
  components   jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ให้เว็บ (anon key) อ่าน/เขียนได้เหมือนตารางอื่นของ StockMaster
alter table public.product_aliases enable row level security;
drop policy if exists "anon_all_product_aliases" on public.product_aliases;
create policy "anon_all_product_aliases"
  on public.product_aliases
  for all
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.product_aliases to anon, authenticated;

-- 3) ให้ PostgREST รู้จักคอลัมน์/ตารางใหม่ทันที
notify pgrst, 'reload schema';

-- ตรวจผล (ควรเห็น 4 คอลัมน์ pick_* และตาราง product_aliases)
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'order_scans' and column_name like 'pick%';
select count(*) as alias_rows from public.product_aliases;

-- ══════════════════════════════════════════════════════════════════════
--  4) จับคู่ล่วงหน้า: ชื่อสินค้าที่ myorder เคยส่งเข้ามาทั้งหมด (118 ชื่อ จากใบสรุป 1,680 ใบ ถึง 7 ก.ย. 2026)
--     ทุกบรรทัดใช้ on conflict do nothing → ถ้ามีคนจับคู่ในหน้าเว็บไปแล้ว จะไม่ทับของเดิม
-- ══════════════════════════════════════════════════════════════════════

-- 4.1) ชื่อตรงกับสินค้าในคลังทุกตัวอักษร (89 ชื่อ) — 1 หน่วยขาย = 1 ชิ้น
insert into public.product_aliases (myorder_name, components) values ('เทปกาวซ่อมมุ้งลวด', '[{"product_id":100,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900026
insert into public.product_aliases (myorder_name, components) values ('ปากกาเก็บขนส่วนเกิน', '[{"product_id":53,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900025
insert into public.product_aliases (myorder_name, components) values ('นาฬิกาดอกโคลเวอร์(สีเขียว)', '[{"product_id":47,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6800127
insert into public.product_aliases (myorder_name, components) values ('นาฬิกาข้อมือชาย(หน้าปัดสีทอง)', '[{"product_id":183,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900153
insert into public.product_aliases (myorder_name, components) values ('ไม้นวดคลายเส้น', '[{"product_id":180,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900150
insert into public.product_aliases (myorder_name, components) values ('ชุดแปรงขัดห้องน้ำ', '[{"product_id":171,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900141
insert into public.product_aliases (myorder_name, components) values ('ยางถนอมล้อกระเป๋า(สีดำ)', '[{"product_id":74,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900051
insert into public.product_aliases (myorder_name, components) values ('กล่องเก็บแก้วน้ำ', '[{"product_id":136,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900111
insert into public.product_aliases (myorder_name, components) values ('ไม้พายปูเตียง', '[{"product_id":116,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900048
insert into public.product_aliases (myorder_name, components) values ('ดินสอเขียนคิ้วแท่งทอง(สีน้ำตาลเข้ม)', '[{"product_id":22,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900043
insert into public.product_aliases (myorder_name, components) values ('นาฬิกาแฟชั่น(สีน้ำตาล)', '[{"product_id":175,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900145
insert into public.product_aliases (myorder_name, components) values ('เทปยาแนวกันน้ำcc(สีทอง)', '[{"product_id":102,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6800075
insert into public.product_aliases (myorder_name, components) values ('ยางถนอมล้อกระเป๋า(สีน้ำเงิน)', '[{"product_id":75,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900052
insert into public.product_aliases (myorder_name, components) values ('ยางถนอมล้อกระเป๋า(สีส้ม)', '[{"product_id":76,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900053
insert into public.product_aliases (myorder_name, components) values ('มีดแกะข้าวโพด', '[{"product_id":70,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900014
insert into public.product_aliases (myorder_name, components) values ('นาฬิกาข้อมือชาย(หน้าปัดสีเงิน)', '[{"product_id":184,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900154
insert into public.product_aliases (myorder_name, components) values ('แปรงล้างจานพร้อมที่ใส่น้ำยา', '[{"product_id":63,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6800018
insert into public.product_aliases (myorder_name, components) values ('ที่รีดหลอดยาสีฟัน', '[{"product_id":216,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900182
insert into public.product_aliases (myorder_name, components) values ('ผ้าคลุมโต๊ะ ( ทรงกลม )(Size L)', '[{"product_id":58,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6800083
insert into public.product_aliases (myorder_name, components) values ('ถุงประคบร้อนเย็น(สีเหลือง)', '[{"product_id":215,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900181
insert into public.product_aliases (myorder_name, components) values ('มาสคาร่าคิ้ว(สีน้ำตาลอ่อน)', '[{"product_id":173,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900143
insert into public.product_aliases (myorder_name, components) values ('นาฬิกาแฟชั่น(สีดำ)', '[{"product_id":174,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900144
insert into public.product_aliases (myorder_name, components) values ('ดินสอเขียนคิ้วแท่งทอง(น้ำตาลอ่อน)', '[{"product_id":23,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900045
insert into public.product_aliases (myorder_name, components) values ('ผ้าขนแกะ', '[{"product_id":225,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900191
insert into public.product_aliases (myorder_name, components) values ('ชั้นเสียบครีมติดผนัง', '[{"product_id":192,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900162
insert into public.product_aliases (myorder_name, components) values ('มาสคาร่าคิ้ว(สีน้ำตาลเข้ม)', '[{"product_id":172,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900142
insert into public.product_aliases (myorder_name, components) values ('ถุงประคบร้อนเย็น(สีชมพู)', '[{"product_id":213,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900179
insert into public.product_aliases (myorder_name, components) values ('เครื่องทำไข่ดาว', '[{"product_id":158,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900128
insert into public.product_aliases (myorder_name, components) values ('ผ้าคลุมโต๊ะ(สี่เหลี่ยม) (Size L)', '[{"product_id":55,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6800087
insert into public.product_aliases (myorder_name, components) values ('ที่ปิดซอกเบาะรถ(สีดำ)', '[{"product_id":220,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900186
insert into public.product_aliases (myorder_name, components) values ('น้ำแข็งสแตนเลส', '[{"product_id":219,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900185
insert into public.product_aliases (myorder_name, components) values ('ถุงประคบร้อนเย็น(สีขาว)', '[{"product_id":212,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900178
insert into public.product_aliases (myorder_name, components) values ('หัวต่อก๊อกน้ำ', '[{"product_id":188,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900158
insert into public.product_aliases (myorder_name, components) values ('กระเป๋าช้อปปิ้งล้อลาก(สีเขียว)', '[{"product_id":211,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900177
insert into public.product_aliases (myorder_name, components) values ('นาฬิกาดอกโคลเวอร์(สีแดง)', '[{"product_id":48,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6800125
insert into public.product_aliases (myorder_name, components) values ('ยางถนอมล้อกระเป๋า(สีชมพู)', '[{"product_id":73,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900050
insert into public.product_aliases (myorder_name, components) values ('ดินสอเขียนคิ้วแท่งทอง(สีดำ)', '[{"product_id":21,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900044
insert into public.product_aliases (myorder_name, components) values ('กระเป๋าช้อปปิ้งล้อลาก(สีน้ำเงิน)', '[{"product_id":232,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900198
insert into public.product_aliases (myorder_name, components) values ('เทปยาแนวกันน้ำcc(สีเงิน)', '[{"product_id":103,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6800076
insert into public.product_aliases (myorder_name, components) values ('ลูกบอลฝอยขัดหม้อ', '[{"product_id":191,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900161
insert into public.product_aliases (myorder_name, components) values ('เทปยาแนวกันน้ำcc(ขาวมุก)', '[{"product_id":101,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6800077
insert into public.product_aliases (myorder_name, components) values ('ตะขอยึดราวม่าน', '[{"product_id":25,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900095
insert into public.product_aliases (myorder_name, components) values ('กระเป๋าเก็บชุดชั้นใน(สีฟ้าอมเทา)', '[{"product_id":218,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900184
insert into public.product_aliases (myorder_name, components) values ('ผ้าคลุมโต๊ะ ( ทรงกลม )(Size XL)', '[{"product_id":60,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6800084
insert into public.product_aliases (myorder_name, components) values ('ผ้าคลุมโต๊ะ(สี่เหลี่ยม) (Size M)', '[{"product_id":56,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6800085
insert into public.product_aliases (myorder_name, components) values ('นาฬิกาดอกโคลเวอร์(ม่วง)', '[{"product_id":45,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900093
insert into public.product_aliases (myorder_name, components) values ('นาฬิกาดอกโคลเวอร์(สีน้ำเงิน)', '[{"product_id":44,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6800142
insert into public.product_aliases (myorder_name, components) values ('พิมพ์ปั้นลูกชิ้น', '[{"product_id":209,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900175
insert into public.product_aliases (myorder_name, components) values ('กระเป๋าเก็บชุดชั้นใน(สีเหลือง)', '[{"product_id":217,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900183
insert into public.product_aliases (myorder_name, components) values ('กระเป๋าเครื่องสำอางค์(สีเบจ)', '[{"product_id":236,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900202
insert into public.product_aliases (myorder_name, components) values ('ผ้าคลุมโต๊ะ ( ทรงกลม )(Size M)', '[{"product_id":227,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900193
insert into public.product_aliases (myorder_name, components) values ('ที่ปิดประตูอัตโนมัติ', '[{"product_id":226,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900192
insert into public.product_aliases (myorder_name, components) values ('กระเป๋าเก็บของ(สีเขียว)', '[{"product_id":229,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900195
insert into public.product_aliases (myorder_name, components) values ('กระเป๋าเครื่องสำอางค์(สีดำ)', '[{"product_id":234,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900200
insert into public.product_aliases (myorder_name, components) values ('กระเป๋าเก็บของ(สีดำ)', '[{"product_id":228,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900194
insert into public.product_aliases (myorder_name, components) values ('กระเป๋าพกพาพับได้(สีครีม)', '[{"product_id":206,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900172
insert into public.product_aliases (myorder_name, components) values ('นาฬิกาสายหนัง', '[{"product_id":199,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900168
insert into public.product_aliases (myorder_name, components) values ('นาฬิกาดอกโคลเวอร์(ชมพู)', '[{"product_id":46,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900094
insert into public.product_aliases (myorder_name, components) values ('ลูกบอลขจัดคราบบ', '[{"product_id":153,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900123
insert into public.product_aliases (myorder_name, components) values ('กระเป๋าพกพาพับได้(สีชมพู)', '[{"product_id":205,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900171
insert into public.product_aliases (myorder_name, components) values ('กระเป๋าพกพาพับได้(สีดำ)', '[{"product_id":204,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900170
insert into public.product_aliases (myorder_name, components) values ('ที่ปิดซอกเบาะรถ(สีครีม)', '[{"product_id":222,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900188
insert into public.product_aliases (myorder_name, components) values ('ที่ปิดซอกเบาะรถ(สีแดง)', '[{"product_id":221,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900187
insert into public.product_aliases (myorder_name, components) values ('ผ้าคลุมโต๊ะ(สี่เหลี่ยม) (Size XL)', '[{"product_id":57,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6800088
insert into public.product_aliases (myorder_name, components) values ('ถุงประคบร้อนเย็น(สีฟ้า)', '[{"product_id":214,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900180
insert into public.product_aliases (myorder_name, components) values ('กล่องเก็บรองเท้า', '[{"product_id":230,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900196
insert into public.product_aliases (myorder_name, components) values ('กล่องเก็บไข่', '[{"product_id":150,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900120
insert into public.product_aliases (myorder_name, components) values ('กระเป๋าเครื่องสำอางค์(สีชมพู)', '[{"product_id":235,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900201
insert into public.product_aliases (myorder_name, components) values ('ช้อนหลอดดูด', '[{"product_id":20,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900068
insert into public.product_aliases (myorder_name, components) values ('กระเป๋าพกพาพับได้(สีกรม)', '[{"product_id":203,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900169
insert into public.product_aliases (myorder_name, components) values ('กระเป๋าช้อปปิ้งล้อลาก(สีส้ม)', '[{"product_id":231,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900197
insert into public.product_aliases (myorder_name, components) values ('ช้อนกรองชา', '[{"product_id":182,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900152
insert into public.product_aliases (myorder_name, components) values ('แปรงสีฟันพกพา(สีครีม)', '[{"product_id":187,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900157
insert into public.product_aliases (myorder_name, components) values ('ถ้วยล้างพร้อมกรอง', '[{"product_id":241,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900207
insert into public.product_aliases (myorder_name, components) values ('เครื่องปอกผลไม้', '[{"product_id":151,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900121
insert into public.product_aliases (myorder_name, components) values ('นาฬิกาวินเทจ (สีทอง)', '[{"product_id":156,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900126
insert into public.product_aliases (myorder_name, components) values ('ราวไม้แขวนเสื้อ', '[{"product_id":238,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900204
insert into public.product_aliases (myorder_name, components) values ('ร่มบังแดดรถยนต์', '[{"product_id":223,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900189
insert into public.product_aliases (myorder_name, components) values ('กระเป๋าช้อปปิ้งล้อลาก(สีเทา)', '[{"product_id":237,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900203
insert into public.product_aliases (myorder_name, components) values ('แปรงสีฟันพกพา(สีเหลือง)', '[{"product_id":186,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900156
insert into public.product_aliases (myorder_name, components) values ('ที่วางแก้วน้ำในรถยนต์', '[{"product_id":197,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900166
insert into public.product_aliases (myorder_name, components) values ('ตาข่ายท่อ', '[{"product_id":27,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900092
insert into public.product_aliases (myorder_name, components) values ('นาฬิกาวินเทจ (สีเงิน)', '[{"product_id":157,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900127
insert into public.product_aliases (myorder_name, components) values ('อ่างน้ำพับได้', '[{"product_id":240,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900206
insert into public.product_aliases (myorder_name, components) values ('ไม้ปัดฝุ่น', '[{"product_id":239,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900205
insert into public.product_aliases (myorder_name, components) values ('เครื่องฉีกไก่(ดำ)', '[{"product_id":92,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900012
insert into public.product_aliases (myorder_name, components) values ('ที่เกี่ยวขาแว่นกันหล่น', '[{"product_id":233,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900199
insert into public.product_aliases (myorder_name, components) values ('อะไหล่แปรงล้างถัง(แยกชิ้น)', '[{"product_id":89,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6800028
insert into public.product_aliases (myorder_name, components) values ('แปรงสีฟันพกพา(สีชมพู)', '[{"product_id":185,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- 6900155

-- 4.2) ชื่อโปร/แพ็ค → ตัดหลายชิ้นต่อ 1 หน่วยขาย (15 ชื่อ) — ระบบเดาตัวคูณจากชื่อ **เช็คก่อนรัน**
--      สมมติว่า 1 ชิ้นในคลังของ "แปรงหินภูเขาไฟ RingX" = 1 แพค, "ตาข่ายกรองฯ" = 1 ชิ้น, "จารบี" = 1 กระปุก, "ที่แคะหู" = 1 กล่อง
--      ถ้าคลังนับหน่วยไม่ตรงกับนี้ ให้แก้เลข "qty" ในบรรทัดนั้นก่อนรัน
insert into public.product_aliases (myorder_name, components) values ('ที่แคะหูซิลิโคนรุ่นใหม่ [กล่องฟ้า](โปร 1 กล่อง)', '[{"product_id":41,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- = 6800012 ที่แคะหูซิลิโคนรุ่นใหม่ × 1 ชิ้น (ขายไป 57 ครั้ง)
insert into public.product_aliases (myorder_name, components) values ('ที่แคะหูซิลิโคนรุ่นใหม่ [กล่องฟ้า](โปร 3 กล่อง)', '[{"product_id":41,"qty":3}]'::jsonb) on conflict (myorder_name) do nothing;  -- = 6800012 ที่แคะหูซิลิโคนรุ่นใหม่ × 3 ชิ้น (ขายไป 54 ครั้ง)
insert into public.product_aliases (myorder_name, components) values ('แปรงหินภูเขาไฟ RingX(2 แพค)', '[{"product_id":109,"qty":2}]'::jsonb) on conflict (myorder_name) do nothing;  -- = 6800016 แปรงหินภูเขาไฟ RingX × 2 ชิ้น (ขายไป 43 ครั้ง)
insert into public.product_aliases (myorder_name, components) values ('แปรงหินภูเขาไฟ RingX(1 แพค)', '[{"product_id":109,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- = 6800016 แปรงหินภูเขาไฟ RingX × 1 ชิ้น (ขายไป 35 ครั้ง)
insert into public.product_aliases (myorder_name, components) values ('แปรงล้างถังน้ำ(1 ชิ้น)', '[{"product_id":108,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- = 6800014 แปรงล้างถังน้ำ × 1 ชิ้น (ขายไป 26 ครั้ง)
insert into public.product_aliases (myorder_name, components) values ('ตาข่ายกรองสิ่งสกปรกเครื่องซักผ้า(โปร 5 ชิ้น)', '[{"product_id":31,"qty":5}]'::jsonb) on conflict (myorder_name) do nothing;  -- = 6800010 ตาข่ายกรองสิ่งสกปรกเครื่องซักผ้า × 5 ชิ้น (ขายไป 21 ครั้ง)
insert into public.product_aliases (myorder_name, components) values ('แปรงล้างถังน้ำ(2 ชิ้น)', '[{"product_id":108,"qty":2}]'::jsonb) on conflict (myorder_name) do nothing;  -- = 6800014 แปรงล้างถังน้ำ × 2 ชิ้น (ขายไป 13 ครั้ง)
insert into public.product_aliases (myorder_name, components) values ('ตาข่ายกรองสิ่งสกปรกเครื่องซักผ้า(โปร 10 ชิ้น)', '[{"product_id":31,"qty":10}]'::jsonb) on conflict (myorder_name) do nothing;  -- = 6800010 ตาข่ายกรองสิ่งสกปรกเครื่องซักผ้า × 10 ชิ้น (ขายไป 11 ครั้ง)
insert into public.product_aliases (myorder_name, components) values ('จารบีสีขาวอเนกประสงค์ 1 แถม 1 ( 2 กระปุก )', '[{"product_id":15,"qty":2}]'::jsonb) on conflict (myorder_name) do nothing;  -- = 6800006 จารบีสีขาวอเนกประสงค์ × 2 ชิ้น (ขายไป 9 ครั้ง)
insert into public.product_aliases (myorder_name, components) values ('แปรงหินภูเขาไฟ RingX(6 แพค ฟรี 1 แพค)', '[{"product_id":109,"qty":7}]'::jsonb) on conflict (myorder_name) do nothing;  -- = 6800016 แปรงหินภูเขาไฟ RingX × 7 ชิ้น (ขายไป 6 ครั้ง)
insert into public.product_aliases (myorder_name, components) values ('อะไหล่หัวฟองน้ำ', '[{"product_id":88,"qty":1}]'::jsonb) on conflict (myorder_name) do nothing;  -- = 6800027 อะไหล่หัวฟองน้ำ (ฝอยล้างจาน) × 1 ชิ้น (ขายไป 3 ครั้ง)
insert into public.product_aliases (myorder_name, components) values ('จารบีสีขาวอเนกประสงค์ 2 แถม 3 ( 5 กระปุก )', '[{"product_id":15,"qty":5}]'::jsonb) on conflict (myorder_name) do nothing;  -- = 6800006 จารบีสีขาวอเนกประสงค์ × 5 ชิ้น (ขายไป 2 ครั้ง)
insert into public.product_aliases (myorder_name, components) values ('ที่แคะหูซิลิโคนรุ่นใหม่ [กล่องฟ้า](โปร 5 แถม 2 รวม 7 กล่อง)', '[{"product_id":41,"qty":7}]'::jsonb) on conflict (myorder_name) do nothing;  -- = 6800012 ที่แคะหูซิลิโคนรุ่นใหม่ × 7 ชิ้น (ขายไป 2 ครั้ง)
insert into public.product_aliases (myorder_name, components) values ('จารบีสีขาวอเนกประสงค์ 3 แถม 4 ( 7 กระปุก )', '[{"product_id":15,"qty":7}]'::jsonb) on conflict (myorder_name) do nothing;  -- = 6800006 จารบีสีขาวอเนกประสงค์ × 7 ชิ้น (ขายไป 1 ครั้ง)
insert into public.product_aliases (myorder_name, components) values ('แปรงล้างถังน้ำ(3 ชิ้น)', '[{"product_id":108,"qty":3}]'::jsonb) on conflict (myorder_name) do nothing;  -- = 6800014 แปรงล้างถังน้ำ × 3 ชิ้น (ขายไป 1 ครั้ง)

-- 4.3) ไม่แน่ใจ — ปิดไว้ก่อน (2 ชื่อ) ถ้าถูกต้องให้ลบ "-- " ข้างหน้าออก
-- insert into public.product_aliases (myorder_name, components) values ('แปรงล้างถังน้ำ((เฉพาะอะไหล่ 5 ชิ้น))', '[{"product_id":89,"qty":5}]'::jsonb) on conflict (myorder_name) do nothing;  -- เดาว่าเป็น 6800028 อะไหล่แปรงล้างถัง(แยกชิ้น) × 5 — ไม่แน่ใจ ถ้าใช่ลบ "-- " ข้างหน้าออกแล้วรัน
-- insert into public.product_aliases (myorder_name, components) values ('แปรงล้างถังน้ำ((เฉพาะอะไหล่ 10 ชิ้น))', '[{"product_id":89,"qty":10}]'::jsonb) on conflict (myorder_name) do nothing;  -- เดาว่าเป็น 6800028 อะไหล่แปรงล้างถัง(แยกชิ้น) × 10 — ไม่แน่ใจ ถ้าใช่ลบ "-- " ข้างหน้าออกแล้วรัน

-- 4.4) ไม่มีในคลัง StockMaster (12 ชื่อ) — ไม่ได้ใส่ให้ ระบบจะถามให้จับคู่ตอนเจอในใบหยิบ
--      (เลือก "ไม่ตัดสต็อกตัวนี้" ถ้าไม่เก็บสต็อกของกลุ่มนี้ หรือ "เพิ่มสินค้าใหม่" ถ้าจะเริ่มเก็บ)
--      • ธูปพญานาค 30 แท่ง  (ขายไป 73 ครั้ง)
--      • ธูปพญานาค 60 แท่ง  (ขายไป 30 ครั้ง)
--      • บัตรขูดท้าวเวสสุวรรณ 10แผ่น ฟรีธูป 10 แท่ง  (ขายไป 26 ครั้ง)
--      • ธูปแดงท้าวเวสสุวรรณ 20 แท่ง  (ขายไป 12 ครั้ง)
--      • ธูปพญานาค 120 แท่ง  (ขายไป 11 ครั้ง)
--      • บัตรขูดพญานาคราช 10 แผ่น ฟรีธูป 10 แท่ง  (ขายไป 5 ครั้ง)
--      • ธูปแดงท้าวเวสสุวรรณ 50 แท่ง  (ขายไป 4 ครั้ง)
--      • ธูปแดงท้าวเวสสุวรรณชุด 50 แท่ง  (ขายไป 1 ครั้ง)
--      • บัตรขูดพระพิฆเนศ 100 ใบ  (ขายไป 1 ครั้ง)
--      • ถุงตาข่ายติดผนัง  (ขายไป 1 ครั้ง)
--      • ขาตั้งนกยูงง  (ขายไป 1 ครั้ง)
--      • ห่วงพิลาทิสออกกำลังกาย(สีดำ)  (คลังมีแต่สีม่วง 6900106 — ไม่มีสีดำ)

select count(*) as alias_rows_after_prefill from public.product_aliases;
