import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from "react";

const SUPABASE_URL = "https://slwbzbnomsugffyzjyuv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNsd2J6Ym5vbXN1Z2ZmeXpqeXV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjIxMDcsImV4cCI6MjA5NTI5ODEwN30.qG3CPT6J_evddK8qmpF7P3bVswn_Du43MEHo33bUnqA";

// รหัสเข้าดูทั้งแท็บ "เช็คสต็อก" (ทุกเมนูย่อย) — เฉพาะผู้จัดการ (กันคนทั่วไปกดเข้าไปโดยไม่ตั้งใจ ไม่ใช่ระบบ auth จริง)
const ORDER_SCANS_PASSWORD = "168168";

const sb = async (path, opts = {}) => {
  const { headers: extraHeaders, prefer, ...restOpts } = opts;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: extraHeaders?.Prefer || prefer || "return=representation",
      ...extraHeaders,
    },
    ...restOpts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || res.statusText);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

// ดึงข้อมูลทั้งหมดแบบ paginate — Supabase/PostgREST จำกัดจำนวนแถวต่อ request ไว้ (ปกติ 1000)
// ถ้าไม่ paginate รายการเก่า (เช่น เดือนที่แล้ว) จะหายไปเงียบๆ เมื่อจำนวนรายการรวมเกินลิมิต
const sbAll = async (path) => {
  const PAGE = 1000;
  let all = [];
  let offset = 0;
  while (true) {
    const sep = path.includes("?") ? "&" : "?";
    const batch = await sb(`${path}${sep}limit=${PAGE}&offset=${offset}`);
    all = all.concat(batch || []);
    if (!batch || batch.length < PAGE) break;
    offset += PAGE;
  }
  return all;
};

const api = {
  getProducts: () => sbAll("products?select=*&order=name.asc"),
  addProduct: (p) => sb("products", { method: "POST", body: JSON.stringify(p) }),
  updateProduct: (id, p) => sb(`products?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(p) }),
  deleteProduct: (id) => sb(`products?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }),
  getTransactions: () => sbAll("transactions?select=*&order=created_at.desc"),
  addTransaction: (t) => sb("transactions", { method: "POST", body: JSON.stringify(t) }),
  getOrderScans: () => sbAll("order_scans?select=*&order=created_at.desc"),
  // ตารางของระบบใบสั่ง (n2p-order.netlify.app) — อยู่ Supabase project เดียวกัน อ่านอย่างเดียว ไม่เขียนกลับ
  getBacklog: () => sbAll("n2p_backlog?select=id,name,total,rounds"),
  // ใบสั่งซื้อทั้งชุด (doc) — ใช้ตอนโชว์รายการรอรับแยกเป็นรายใบในหน้า "รับสินค้าเข้า" (สินค้าเดียวอาจมาจากหลายใบพร้อมกัน)
  getOrders: () => sbAll("n2p_orders?select=id,doc_no,data"),
  // เขียนกลับตัดยอดรอบสั่งให้อัตโนมัติตอนผู้จัดการอนุมัติใน StockMaster (แทนฝ่ายจัดซื้อติ๊ก/กรอกเองใน n2p-order) — ดึงสดก่อนเขียนเสมอกันชนกับคนแก้พร้อมกัน
  getBacklogItem: (id) => sb(`n2p_backlog?id=eq.${id}&select=*`).then(rows => (rows && rows[0]) || null),
  updateBacklogRounds: (id, rounds) => sb(`n2p_backlog?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ rounds }) }),
  getOrderDoc: (id) => sb(`n2p_orders?id=eq.${id}&select=*`).then(rows => (rows && rows[0]) || null),
  updateOrderDocData: (id, docNo, data) => sb(`n2p_orders?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ doc_no: docNo, data }) }),
  reviewOrderScan: (id, by) => sb(`order_scans?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ reviewed: true, reviewed_by: by, reviewed_at: new Date().toISOString() }) }),
  unreviewOrderScan: (id) => sb(`order_scans?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ reviewed: false, reviewed_by: null, reviewed_at: null }) }),
  deleteOrderScan: (id) => sb(`order_scans?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }),
  setOrderScanEffectiveDate: (id, date) => sb(`order_scans?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ effective_date: date }) }),
  // ── ยิงตัดสต๊อกจากใบหยิบ (สลิป MyOrder extension → order_scans) ──
  getRecentOrderScans: (sinceIso) => sbAll(`order_scans?select=*&created_at=gte.${encodeURIComponent(sinceIso)}&order=created_at.desc`),
  getOrderScansRange: (fromIso, toIso) => sbAll(`order_scans?select=*&created_at=gte.${encodeURIComponent(fromIso)}&created_at=lte.${encodeURIComponent(toIso)}&order=created_at.desc`),
  getOrderScan: (id) => sb(`order_scans?id=eq.${Number(id)}&select=*`),
  updateOrderScan: (id, patch) => sb(`order_scans?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  getAliases: () => sbAll("product_aliases?select=*"),
  // components = [{product_id, qty}] — ขาย 1 หน่วยชื่อนี้ ต้องตัดสินค้าอะไรกี่ชิ้น ([] = ไม่มีในคลัง ไม่ตัด)
  upsertAlias: (name, components) => sb("product_aliases?on_conflict=myorder_name", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ myorder_name: name, components, updated_at: new Date().toISOString() }) }),
  // ── บันทึกสินค้าค้างส่ง (เมนูย่อยใต้เช็คสต็อก) — แถวเดียวคงที่ id=1 เก็บเป็น jsonb ให้ทุกเครื่อง/ทุกคนเห็นตรงกัน ต้องรัน backlog-notes-setup.sql ก่อน ──
  getBacklogNotes: () => sb("backlog_notes?id=eq.1&select=*").then(rows => (rows && rows[0]) || null),
  saveBacklogNotes: (items) => sb("backlog_notes?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ id: 1, items, saved_at: new Date().toISOString() }) }),
  // แก้ไข/ลบ/ใส่หมายเหตุทีละรายการ — ไม่แตะ saved_at (ไม่ใช่การบันทึกใหม่ แค่แก้ของเดิม)
  patchBacklogNoteItems: (items) => sb("backlog_notes?id=eq.1", { method: "PATCH", body: JSON.stringify({ items }) }),
  // โน้ตข้อความเดียวอยู่บนสุดของหน้า (ฝากถึงฝ่ายอื่น) แยกจากรายการสินค้า — ต้องรัน sql/backlog-notes-add-note-column.sql ก่อน
  updateBacklogNote: (note) => sb("backlog_notes?id=eq.1", { method: "PATCH", body: JSON.stringify({ note }) }),
  // ── รับสินค้าเข้า (แทนใบพิมพ์กระดาษ) — ฝ่ายคลังบันทึกก่อน (pending) ผู้จัดการอนุมัติทีหลังถึงเข้าสต็อกจริง ต้องรัน receiving-logs-setup.sql ก่อน ──
  getReceivingLogs: () => sbAll("receiving_logs?select=*&order=created_at.desc"),
  addReceivingLogs: (rows) => sb("receiving_logs", { method: "POST", body: JSON.stringify(rows) }), // รับ array บันทึกหลายแถวพร้อมกันได้
  updateReceivingLog: (id, patch) => sb(`receiving_logs?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteReceivingLog: (id) => sb(`receiving_logs?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }),
};

const dbToProduct = (r) => ({
  id: r.id, sku: r.sku, name: r.name, category: r.category || "-",
  quantity: r.quantity, minStock: r.min_stock, price: Number(r.price),
  location: r.location || "-", unit: r.unit, imageUrl: r.image_url,
});
const productToDb = (p) => ({
  sku: p.sku, name: p.name, category: p.category,
  quantity: parseInt(p.quantity) || 0,
  min_stock: parseInt(p.minStock) || 0,
  price: parseFloat(p.price) || 0,
  location: p.location || "-", unit: p.unit || "ชิ้น",
  image_url: p.imageUrl || null,
});
const dbToTx = (r) => ({
  id: r.id, type: r.type, productId: r.product_id,
  quantity: r.quantity, date: r.date, note: r.note, by: r.by,
  createdAt: r.created_at,
});

// ═══════════ จับคู่ "ของรอเข้า" จากระบบใบสั่ง (n2p_backlog) กับสินค้าในคลัง ═══════════
// ชื่อสินค้าสองระบบพิมพ์กันคนละที เช่น "ดินสอเขียนคิ้วแท่งทอง(สีน้ำตาลเข้ม)" ในใบสั่ง
// กับ "ดินสอเขียนคิ้วแท่งทอง(น้ำตาลเข้ม)" ในคลัง — ต้องเทียบแบบยืดหยุ่น
// แต่ห้ามยืดหยุ่นจนจับผิดสี/ผิดไซซ์ (ทดสอบแล้วแบบหลวมๆ จะเอา "(สีกรม)" ไปชน "แครรอท")
// กติกา: ข้อความในวงเล็บถือเป็น "คุณสมบัติ" (สี/ไซซ์/ทรง) ถ้าชนกันตัดทิ้งทันที ไม่ต้องดูความคล้าย

const THAI_TONES = "\u0e48\u0e49\u0e4a\u0e4b";
// คำว่า "สี" — ต้องไม่กิน "สี่" ใน "สี่เหลี่ยม" จึงกันด้วย lookahead วรรณยุกต์
const RE_SI = new RegExp("\u0e2a\u0e35(?![" + THAI_TONES + "])", "g");
const RE_PAREN = /[([][^)\]]*[)\]]/g;

const normName = (s) => String(s || "").toLowerCase()
  .replace(RE_SI, "")
  .replace(/size\s*/g, "size")
  .replace(/[\s\u200B\-_/\\.,'"+*#!?]/g, "");

// แยกชื่อออกเป็น "ชื่อหลัก" กับ "คุณสมบัติในวงเล็บ"
const splitAttrs = (name) => {
  const raw = String(name || "").toLowerCase();
  const attrs = new Set();
  (raw.match(RE_PAREN) || []).forEach(g => {
    const a = normName(g.slice(1, -1));
    if (a) attrs.add(a);
  });
  return { base: normName(raw.replace(RE_PAREN, "")), attrs };
};

const isSubset = (a, b) => [...a].every(x => b.has(x));

// ความคล้าย 0–1 จากระยะ Levenshtein
const levRatio = (a, b) => {
  if (a === b) return 1;
  const m = Math.max(a.length, b.length);
  if (!m) return 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[b.length] / m;
};

const MATCH_CUTOFF = 0.86; // ต่ำกว่านี้ถือว่าไม่ใช่ตัวเดียวกัน ให้ไปจับคู่เอง

const nameScore = (bName, pName) => {
  const fb = normName(bName), fp = normName(pName);
  if (fb === fp) return { score: 1, how: "ชื่อตรงกัน" };
  const B = splitAttrs(bName), P = splitAttrs(pName);
  // สี/ไซซ์ในวงเล็บขัดกัน = คนละตัวแน่นอน
  if (B.attrs.size && P.attrs.size && !isSubset(B.attrs, P.attrs) && !isSubset(P.attrs, B.attrs))
    return { score: 0, how: "สี/ไซซ์ไม่ตรง" };
  const attrsEqual = B.attrs.size === P.attrs.size && isSubset(B.attrs, P.attrs);
  if (B.base === P.base && attrsEqual) return { score: 0.99, how: "ชื่อ+วงเล็บตรงกัน" };

  const cands = [];
  // เทียบเฉพาะ "ชื่อหลัก" ได้ต่อเมื่อมีวงเล็บทั้งคู่หรือไม่มีทั้งคู่
  // ถ้ามีฝั่งเดียว อีกฝั่งอาจซ่อนสี/รุ่นไว้ในชื่อหลัก ตัดวงเล็บทิ้งแล้วเทียบจะจับผิดตัว
  if (B.base && P.base && (B.attrs.size > 0) === (P.attrs.size > 0)) {
    if (B.base === P.base) cands.push({ score: 0.97, how: "ชื่อหลักตรงกัน" });
    else if (Math.min(B.base.length, P.base.length) >= 6 && (B.base.startsWith(P.base) || P.base.startsWith(B.base)))
      cands.push({ score: 0.95, how: "ชื่อหลักขึ้นต้นเหมือนกัน" });
    else cands.push({ score: levRatio(B.base, P.base), how: "ชื่อหลักคล้ายกัน" });
  }
  if (Math.min(fb.length, fp.length) >= 6 && (fb.startsWith(fp) || fp.startsWith(fb)))
    cands.push({ score: 0.95, how: "ชื่อขึ้นต้นเหมือนกัน" });
  cands.push({ score: levRatio(fb, fp), how: "ชื่อคล้ายกัน" });

  const best = cands.reduce((a, c) => (c.score > a.score ? c : a));
  return best.score >= MATCH_CUTOFF ? best : { score: 0, how: "ไม่ใกล้พอ" };
};

// เดาสินค้าจากชื่อด้วย nameScore — ต้อง "ชนะขาด" ตัวรองเท่านั้น (ใช้เฉพาะฟีเจอร์ "บันทึกค้างส่ง" แยกจาก guessProduct ของ AliasEditor)
const scoreMatchProduct = (name, products) => {
  let best = null, second = 0;
  products.forEach(p => {
    const r = nameScore(name, p.name); if (r.score <= 0) return;
    if (!best || r.score > best.score) { if (best) second = Math.max(second, best.score); best = { ...r, p }; }
    else if (r.score > second) second = r.score;
  });
  if (best && (best.score >= 0.99 || best.score - second >= 0.03)) return best.p;
  return null;
};

// จับคู่ชื่อสินค้าจากระบบใบสั่ง (n2p_backlog/n2p_orders) เข้ากับสินค้าในคลัง — ใช้ร่วมกันทั้งยอด
// "รอเข้า/ค้างส่ง" รวมในตาราง Inventory และรายการรอรับแยกใบใน "รับสินค้าเข้า" กันตรรกะเพี้ยนคนละที่
// ที่ผู้ใช้ตั้งเองมาก่อนเสมอ (incomingAlias) ถ้าไม่มีค่อยให้ระบบเดา และเดาได้ต่อเมื่อ "ชนะขาด" ตัวรองเท่านั้น
const matchBacklogName = (key, rawProducts, incomingAlias) => {
  if (Object.prototype.hasOwnProperty.call(incomingAlias, key)) {
    const pid = incomingAlias[key];
    return { productId: pid == null ? null : pid, how: pid == null ? "ตั้งเองว่าไม่จับคู่" : "จับคู่เอง", score: 1, manual: true };
  }
  let best = null, second = 0;
  rawProducts.forEach(p => {
    const r = nameScore(key, p.name);
    if (r.score <= 0) return;
    if (!best || r.score > best.score) { if (best) second = Math.max(second, best.score); best = { ...r, p }; }
    else if (r.score > second) second = r.score;
  });
  if (best && (best.score >= 0.99 || best.score - second >= 0.03))
    return { productId: best.p.id, how: best.how, score: best.score, manual: false };
  return { productId: null, how: best ? "ใกล้เคียงหลายตัว เลือกเองก่อน" : "ไม่พบสินค้าที่ตรงกัน", score: 0, manual: false };
};

// ของรอเข้าของรายการหนึ่ง = ผลรวมของรอบที่ยังเข้าไม่ครบ (สูตรเดียวกับหน้ารอสั่งของระบบใบสั่ง) หักด้วยยอดที่ฝ่ายคลังบันทึกไว้แต่ผู้จัดการยังไม่อนุมัติ (loggedByRound)
// ตอนอนุมัติแล้ว StockMaster เขียนกลับเข้า n2p_backlog.rounds.receivedQty ให้เองอัตโนมัติ (ดู syncApprovalToOrderSystem) ยอด receivedQty จึงแม่นอยู่แล้วไม่ต้องหักซ้ำ
// ที่ต้องหักคือช่วง "รออนุมัติ" เท่านั้น กันพนักงานอีกคนเห็นว่ายังไม่มีใครบันทึกแล้วบันทึกซ้ำก่อนผู้จัดการจะกดอนุมัติทัน
// รอบแรกอาจเป็น meta element ที่ระบบใบสั่งใช้เก็บ tag — ต้องข้าม
const backlogInTransit = (row, loggedByRound) => (Array.isArray(row?.rounds) ? row.rounds : [])
  .reduce((sum, r) => {
    if (r && r.___meta) return sum;
    const logged = loggedByRound ? (loggedByRound.get(String(r?.id)) || 0) : 0;
    return sum + Math.max(0, (Number(r?.qty) || 0) - (Number(r?.receivedQty) || 0) - logged);
  }, 0);

// ยอดที่ฝ่ายคลังบันทึกไว้แต่ยังรออนุมัติ (status='pending') ต่อรอบสั่ง — ไม่นับ approved/skipped เพราะ approved ถูกเขียนกลับเข้า receivedQty จริงแล้ว นับซ้ำจะหักเกิน
const loggedQtyByRound = (receivingLogs) => {
  const m = new Map();
  (receivingLogs || []).filter(r => r.status === "pending" && r.backlog_round_id != null).forEach(r => {
    const key = String(r.backlog_round_id);
    m.set(key, (m.get(key) || 0) + (Number(r.received_qty) || 0));
  });
  return m;
};

// ตัดยอดกลับเข้าระบบใบสั่งซื้อให้อัตโนมัติตอนผู้จัดการอนุมัติใน StockMaster — แทนที่ฝ่ายจัดซื้อจะต้องติ๊ก/กรอกจำนวนเองใน n2p-order
// มิเรอร์ toggleRoundReceived + syncRoundToDoc ของระบบใบสั่งเป๊ะ (อ่านจากซอร์สจริงมาก่อนเขียน) ให้สถานะ "เข้าครบ/บางส่วน" ตรงกันทั้ง 2 ระบบเสมอ
// ดึงข้อมูลสดก่อนเขียนทุกครั้ง (ไม่ใช้ค่าที่ค้างอยู่ในเครื่อง) ลดความเสี่ยงชนกับคนแก้พร้อมกัน — เขียนไม่สำเร็จไม่ทำให้การเพิ่มสต็อกล้มเหลวตามไปด้วย (สต็อกเข้าไปแล้วสำคัญกว่า แค่แจ้งเตือน)
async function syncApprovalToOrderSystem(row, qty) {
  if (row.backlog_item_id == null || row.backlog_round_id == null) return;
  const freshItem = await api.getBacklogItem(row.backlog_item_id);
  if (!freshItem) return;
  let newReceivedQty = qty;
  const rounds = (freshItem.rounds || []).map(r => {
    if ((r && r.___meta) || String(r.id) !== String(row.backlog_round_id)) return r;
    newReceivedQty = (Number(r.receivedQty) || 0) + qty;
    return { ...r, receivedQty: newReceivedQty, received: newReceivedQty >= (Number(r.qty) || 0) };
  });
  await api.updateBacklogRounds(row.backlog_item_id, rounds);

  if (row.doc_id != null) {
    const freshDoc = await api.getOrderDoc(row.doc_id);
    if (freshDoc && freshDoc.data) {
      const data = { ...freshDoc.data };
      data.items = (data.items || []).map(it => String(it.backlogRoundId) === String(row.backlog_round_id) ? { ...it, received: newReceivedQty } : it);
      const named = data.items.filter(i => i.name);
      data.status = named.length && named.every(i => i.received === i.ordered) ? "complete"
        : named.some(i => i.received > 0) ? "partial" : "pending";
      if (data.status !== "pending" && !data.recvDate) data.recvDate = new Date().toISOString().split("T")[0];
      await api.updateOrderDocData(row.doc_id, data.docNo || freshDoc.doc_no, data);
    }
  }
}

// การจับคู่ที่ผู้ใช้ตั้งเอง เก็บใน localStorage — ตาราง n2p_backlog เพิ่มคอลัมน์ไม่ได้
// และ meta element ใน rounds ถูกระบบใบสั่งเขียนทับทุกครั้งที่บันทึก
const ALIAS_KEY = "n2p_incoming_alias_v1";
const loadAliasMap = () => {
  try { return JSON.parse(localStorage.getItem(ALIAS_KEY) || "{}"); } catch { return {}; }
};

// ช่องเลือกสินค้าแบบพิมพ์กรองได้ — คลังมีร้อยกว่ารายการ ใช้ <select> ธรรมดาแล้วเลื่อนหาไม่ไหว
// กางแบบดันเนื้อหาลง (ไม่ลอยทับ) เพราะอยู่ในกล่องที่เลื่อนได้ ถ้าลอยจะโดนตัดขอบ
function ProductPicker({ products, value, autoLabel, onPick }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const kw = q.trim().toLowerCase();
  const list = kw
    ? products.filter(p => p.name.toLowerCase().includes(kw) || String(p.sku || "").toLowerCase().includes(kw))
    : products;
  const NONE_LABEL = "— ไม่จับคู่ —";
  const current = value === "auto" ? autoLabel
    : value === "none" ? NONE_LABEL
    : (products.find(p => String(p.id) === value)?.name || NONE_LABEL);
  const pick = (v) => { onPick(v); setOpen(false); setQ(""); };
  const Row = ({ v, label, active }) => (
    <div onClick={() => pick(v)}
      style={{ padding: "7px 10px", fontSize: 12.5, cursor: "pointer", borderRadius: 8, background: active ? "#F5F3FF" : "transparent", color: active ? "#6D28D9" : "#374151", fontWeight: active ? 700 : 400 }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = "#F9FAFB"; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
      {label}
    </div>
  );
  return (
    <div style={{ maxWidth: 320 }}>
      <button type="button" className="inp" onClick={() => { setOpen(o => !o); setQ(""); }}
        style={{ width: "100%", textAlign: "left", cursor: "pointer", padding: "6px 8px", fontSize: 12.5, background: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current}</span>
        <span style={{ color: "#9CA3AF", fontSize: 10 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ marginTop: 4, border: "1px solid #E5E7EB", borderRadius: 12, background: "#fff", boxShadow: "0 8px 24px rgba(0,0,0,0.08)", padding: 6 }}>
          <input className="inp" autoFocus placeholder="🔍 พิมพ์ชื่อ / SKU เพื่อกรอง..."
            value={q} onChange={e => setQ(e.target.value)} style={{ padding: "6px 8px", fontSize: 12.5, marginBottom: 4 }} />
          <div style={{ maxHeight: 190, overflowY: "auto" }}>
            {!kw && <Row v="auto" label={autoLabel} active={value === "auto"} />}
            {!kw && <Row v="none" label={NONE_LABEL} active={value === "none"} />}
            {list.map(p => <Row key={p.id} v={String(p.id)} label={`${p.name}  ·  ${p.sku}`} active={value === String(p.id)} />)}
            {list.length === 0 && (
              <div style={{ padding: 12, fontSize: 12, color: "#9CA3AF", textAlign: "center" }}>ไม่พบสินค้าที่ตรงกับ "{q}"</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// มุมมองการแสดงผลของแต่ละรายการเคลื่อนไหว (รองรับ in / out / adjust)
const txView = (tx, unit) => {
  const u = unit || "";
  if (tx.type === "in")  return { label: "▲ รับเข้า",   color: "#7c3aed", badge: "badge-ok",     amount: `+${tx.quantity} ${u}` };
  if (tx.type === "adjust") {
    const d = tx.quantity || 0;
    return { label: "⚖ ปรับสต็อก", color: "#d97706", badge: "badge-adjust", amount: `${d >= 0 ? "+" : "−"}${Math.abs(d)} ${u}` };
  }
  return { label: "▼ เบิกออก", color: "#ff5555", badge: "badge-out", amount: `-${tx.quantity} ${u}` };
};

const CATEGORIES = ["ทั้งหมด", "กำลังขาย", "-"];


// ============================================================
// RETURN CHECKER — พัสดุตีกลับ
// ============================================================

const parseFlashText = (raw) => {
  // รองรับ Flash (TH...), ไปรษณีย์ไทย (WA, EF, RL, CP...), Kerry (KER), J&T (JT) ฯลฯ
  const re = /[A-Z]{2}[A-Z0-9]{8,}/g;
  const matches = raw.toUpperCase().match(re);
  if (!matches) return [];
  // กรองเฉพาะที่เป็น tracking number จริงๆ (ยาวพอ, ไม่ใช่คำทั่วไป)
  return [...new Set(matches.filter(m => m.length >= 10))];
};

// ── Parser: รับข้อความจาก "N2P Flash ตีกลับ Copy" extension ──
// รูปแบบ: บรรทัดวันที่ DD/MM/YYYY (มีได้หลายบล็อกในข้อความเดียว) ตามด้วยบรรทัด เลขขาไป(เลขขากลับ) เวลา
// รองรับปี พ.ศ. (แปลงเป็น ค.ศ. อัตโนมัติ) และข้ามบรรทัดว่างคั่นกลางได้
// คืนค่า { date, items: [{ outbound, returnCode, time, date }] }
// — date ของแต่ละ item อิงจากบรรทัดวันที่ล่าสุดที่อยู่ก่อนหน้า (ถ้าไม่มีเลยจะเป็น null ให้ผู้เรียกใช้ fallback เอง)
const parseFlashItemsText = (raw) => {
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  let firstDate = null;
  let currentDate = null;
  const items = [];
  const dateRe = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const itemRe = /^([A-Z0-9]+)\(([A-Z0-9]+)\)\s*(\d{1,2}:\d{2})?$/i;

  lines.forEach(line => {
    const dm = line.match(dateRe);
    if (dm) {
      let y = Number(dm[3]);
      if (y > 2400) y -= 543; // ปี พ.ศ. -> ค.ศ.
      // DD/MM/YYYY -> YYYY-MM-DD (เก็บแบบเดียวกับ session_date)
      currentDate = `${y}-${String(dm[2]).padStart(2, "0")}-${String(dm[1]).padStart(2, "0")}`;
      if (!firstDate) firstDate = currentDate;
      return;
    }
    const im = line.match(itemRe);
    if (im) {
      items.push({
        outbound: im[1].toUpperCase(),
        returnCode: im[2].toUpperCase(),
        time: im[3] || "",
        date: currentDate,
      });
    }
  });

  return { date: firstDate, items };
};

const sbReturn = async (path, opts = {}) => {
  const { headers: extraHeaders, ...restOpts } = opts;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json", Prefer: "return=representation", ...extraHeaders },
    ...restOpts,
  });
  if (!res.ok) throw await res.json().catch(() => ({}));
  const text = await res.text();
  return text ? JSON.parse(text) : [];
};

// ดึงข้อมูลทั้งหมดแบบ paginate (รองรับหลักพัน rows)
const sbReturnAll = async (table, filter = "") => {
  const PAGE = 1000;
  let all = [];
  let offset = 0;
  while (true) {
    const sep = filter ? "&" : "?";
    const url = `${table}${filter ? "?" + filter : ""}${sep}limit=${PAGE}&offset=${offset}`;
    const batch = await sbReturn(url);
    all = all.concat(batch || []);
    if (!batch || batch.length < PAGE) break;
    offset += PAGE;
  }
  return all;
};

// ── SheetJS Excel Export ──
async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = () => resolve(window.XLSX);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function exportReport(sessions) {
  const XLSX = await loadXLSX();
  const allScans = [];
  for (const s of sessions) {
    const scans = await sbReturnAll("return_scans", `session_id=eq.${s.id}&select=tracking_code,scanned_at,scanned_by`);
    scans.forEach(sc => allScans.push({ ...sc, session_id: s.id, session_date: s.created_at }));
  }
  const systemList = [...new Set(sessions.flatMap(s => s.tracking_list || []))];
  const scannedSet = new Set(allScans.map(sc => sc.tracking_code));
  const scannedList = allScans.map(sc => sc.tracking_code);
  const HEADER_STYLE = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1A3C5E" } } };
  const GREEN = { fill: { fgColor: { rgb: "C6EFCE" } } };
  const RED   = { fill: { fgColor: { rgb: "FFCCCC" } } };
  const wb = XLSX.utils.book_new();

  // Sheet 1: ระบบแจ้ง
  const ws1 = XLSX.utils.aoa_to_sheet([
    [{ v: "เลข Tracking (จากระบบ)", s: HEADER_STYLE }, { v: "สถานะ", s: HEADER_STYLE }, { v: "วันที่แจ้ง", s: HEADER_STYLE }],
    ...systemList.map(code => {
      const ok = scannedSet.has(code);
      const sess = sessions.find(s => (s.tracking_list||[]).includes(code));
      return [
        { v: code, s: ok ? GREEN : RED },
        { v: ok ? "รับแล้ว" : "ยังไม่รับ", s: ok ? GREEN : RED },
        { v: sess ? new Date(sess.created_at).toLocaleDateString("th-TH") : "" },
      ];
    })
  ]);
  ws1["!cols"] = [{ wch: 30 }, { wch: 16 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws1, "แจ้งจากระบบ");

  // Sheet 2: พนักงานยิง
  const ws2 = XLSX.utils.aoa_to_sheet([
    [{ v: "เลข Tracking (พนักงานยิง)", s: HEADER_STYLE }, { v: "สถานะ", s: HEADER_STYLE }, { v: "ผู้ยิง", s: HEADER_STYLE }, { v: "เวลายิง", s: HEADER_STYLE }],
    ...allScans.map(sc => {
      const ok = systemList.includes(sc.tracking_code);
      return [
        { v: sc.tracking_code, s: ok ? GREEN : RED },
        { v: ok ? "ตรงกับระบบ" : "ไม่อยู่ในระบบ", s: ok ? GREEN : RED },
        { v: sc.scanned_by || "-" },
        { v: sc.scanned_at ? new Date(sc.scanned_at).toLocaleString("th-TH") : "-" },
      ];
    })
  ]);
  ws2["!cols"] = [{ wch: 30 }, { wch: 18 }, { wch: 14 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, ws2, "พนักงานยิง");

  // Sheet 3: สรุปยอด
  const matched = systemList.filter(c => scannedSet.has(c));
  const missing = systemList.filter(c => !scannedSet.has(c));
  const extra   = [...new Set(scannedList)].filter(c => !systemList.includes(c));
  const pct = systemList.length > 0 ? Math.round(matched.length / systemList.length * 100) : 0;
  const summaryRows = [
    [{ v: "สรุปรายงานพัสดุตีกลับ", s: { font: { bold: true, sz: 14 } } }, ""],
    ["วันที่ออกรายงาน", new Date().toLocaleDateString("th-TH", { dateStyle: "long" })],
    ["จำนวนเซสชัน", sessions.length],
    ["", ""],
    [{ v: "รายการ", s: HEADER_STYLE }, { v: "จำนวน (ชิ้น)", s: HEADER_STYLE }],
    ["แจ้งจากระบบทั้งหมด", systemList.length],
    ["รับเข้าตรงกับระบบ", matched.length],
    ["ยังไม่ได้รับ", missing.length],
    ["ยิงแต่ไม่อยู่ในระบบ", extra.length],
    ["ยิงทั้งหมด", allScans.length],
    ["", ""],
    [{ v: `ความครบถ้วน: ${pct}%`, s: { font: { bold: true, color: { rgb: pct === 100 ? "007A3D" : "CC0000" } } } }, ""],
  ];
  if (missing.length > 0) {
    summaryRows.push(["", ""], [{ v: "รายการที่ยังไม่ได้รับ:", s: { font: { bold: true } } }, ""]);
    missing.forEach(c => summaryRows.push([c, { v: "ยังไม่รับ", s: RED }]));
  }
  const ws3 = XLSX.utils.aoa_to_sheet(summaryRows);
  ws3["!cols"] = [{ wch: 36 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws3, "สรุปยอด");

  XLSX.writeFile(wb, `return_report_${todayStr()}.xlsx`);
}


// ============================================================
// RETURN SUMMARY PANEL — สรุปรวม ตีกลับในระบบ + ตีกลับถึงคลัง
// แท็บที่ 3 ใน ReturnCheckerTab
// ตัวกรองอิสระ 2 ชุด: sessions (Flash แจ้ง) / scans (ถึงคลัง)
// + toggle "ยังไม่ถึงคลัง" (highlight สีแดงทั้งหมด)
// ============================================================

// ── แปลง Date เป็น "YYYY-MM-DD" ตามเวลาท้องถิ่นของเครื่อง (ไม่ใช่ UTC) ──
// สำคัญมาก: toISOString() แปลงเป็น UTC เสมอ ซึ่งสำหรับไทย (UTC+7) จะทำให้วันที่ถอยหลังไป 1 วัน
// ในช่วงเที่ยงคืนถึงประมาณ 7 โมงเช้า (เช่น 1 ก.ค. 00:30 น. จะกลายเป็น "2026-06-30" แทนที่จะเป็น "2026-07-01")
function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function todayStr() { return localDateStr(new Date()); }
function yesterdayStr() { const d = new Date(); d.setDate(d.getDate() - 1); return localDateStr(d); }
function thisMonthRange() {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { from: localDateStr(first), to: localDateStr(last) };
}
function lastMonthRange() {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const last = new Date(d.getFullYear(), d.getMonth(), 0);
  return { from: localDateStr(first), to: localDateStr(last) };
}

function useDateFilterState(defaultMode = "all") {
  const [mode, setMode] = useState(defaultMode); // all | today | yesterday | thisMonth | lastMonth | range
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(todayStr());
  let rangeFrom = from, rangeTo = to;
  if (mode === "today") { rangeFrom = todayStr(); rangeTo = todayStr(); }
  else if (mode === "yesterday") { rangeFrom = yesterdayStr(); rangeTo = yesterdayStr(); }
  else if (mode === "thisMonth") { const r = thisMonthRange(); rangeFrom = r.from; rangeTo = r.to; }
  else if (mode === "lastMonth") { const r = lastMonthRange(); rangeFrom = r.from; rangeTo = r.to; }
  return { mode, setMode, from, setFrom, to, setTo, rangeFrom, rangeTo };
}

// ── โหลด return_scans ทั้งหมด (ไม่กรองวันที่ — ใช้แสดงผลและเทียบกับประวัติ Flash แจ้งทั้งหมดเสมอ) ──
async function loadAllScans() {
  return sbReturnAll("return_scans", "select=*&order=scanned_at.desc");
}

// ── UI ที่ใช้ร่วมกัน: ตัวเลือกช่วงเวลา ทั้งหมด / เดือนนี้ / เดือนที่แล้ว / กำหนดเอง ──
function DateFilterRow({ filter, accent }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {[["all", "ทั้งหมด"], ["today", "วันนี้"], ["yesterday", "เมื่อวาน"], ["thisMonth", "เดือนนี้"], ["lastMonth", "เดือนที่แล้ว"]].map(([v, l]) => (
        <button key={v} onClick={() => filter.setMode(v)}
          style={{
            background: filter.mode === v ? accent : "#fff",
            color: filter.mode === v ? "#fff" : "#6B7280",
            border: "1px solid #E5E7EB", borderRadius: 8, padding: "6px 12px",
            fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Sarabun', sans-serif",
          }}>
          {l}
        </button>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 4, background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "3px 8px" }}>
        <span style={{ fontSize: 11, color: "#9CA3AF" }}>กำหนดเอง:</span>
        <input type="date" value={filter.from}
          onChange={e => { filter.setFrom(e.target.value); filter.setMode("range"); }}
          style={{ background: "transparent", border: "none", color: "#374151", fontSize: 11, outline: "none", fontFamily: "'Sarabun', sans-serif", width: 100 }} />
        <span style={{ color: "#9CA3AF", fontSize: 11 }}>—</span>
        <input type="date" value={filter.to}
          onChange={e => { filter.setTo(e.target.value); filter.setMode("range"); }}
          style={{ background: "transparent", border: "none", color: "#374151", fontSize: 11, outline: "none", fontFamily: "'Sarabun', sans-serif", width: 100 }} />
      </div>
    </div>
  );
}

function ReturnSummaryPanel({ onGoToMyorder }) {
  const summaryFilter = useDateFilterState("all"); // ตัวกรองช่วงเวลา — ใช้กรองทุกคอลัมน์ร่วมกัน (Flash แจ้ง / ถึงคลัง / ตีกลับ myorder)
  const [showMissingOnly, setShowMissingOnly] = useState(false);

  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [scans, setScans] = useState([]);
  const [flashItems, setFlashItems] = useState([]); // return_flash_items ของ sessions ที่โหลดมา (ตามตัวกรอง summaryFilter)
  const [myorderItems, setMyorderItems] = useState([]); // return_myorder_items ทั้งหมด (ไม่กรองวันที่ — เทียบจาก outbound_tracking)

  const loadData = async () => {
    setLoading(true);
    try {
      const [sessRows, scanRows, myorderRows] = await Promise.all([
        sbReturnAll("return_sessions", "select=*&order=session_date.desc"),
        loadAllScans(),
        sbReturnAll("return_myorder_items", "select=*&order=imported_at.desc"),
      ]);
      setSessions(sessRows || []);
      setScans(scanRows || []);
      setMyorderItems(myorderRows || []);

      // โหลด return_flash_items ของ session ทั้งหมด (ไม่จำกัดช่วงเวลา) — ตัวกรองช่วงเวลาทำที่ฝั่ง client แทน
      // เพื่อให้ "ยิงเกิน" และการแมทช์ ตีกลับ myorder อ้างอิงจากประวัติ Flash ทั้งหมดเสมอ ไม่ผูกกับช่วงเวลาที่เลือกดู
      const sessionIds = (sessRows || []).map(s => s.id);
      if (sessionIds.length > 0) {
        const flashRows = await sbReturnAll("return_flash_items", `session_id=in.(${sessionIds.join(",")})&select=outbound_tracking,return_tracking,flash_time,session_id`);
        setFlashItems(flashRows || []);
      } else {
        setFlashItems([]);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []); // โหลดครั้งเดียว — เปลี่ยนช่วงเวลาแล้วกรองที่ฝั่ง client ไม่ต้องโหลดใหม่

  // ── คำนวณ matched / missing / extra — กรองทุกชุดข้อมูลด้วยช่วงเวลาเดียวกัน (Flash แจ้งเป็นตัวอ้างอิงหลัก) ──
  // systemList: เลขขากลับที่ Flash แจ้ง ในขอบเขตช่วงเวลาที่เลือก (ทั้งหมด/เดือนนี้/เดือนที่แล้ว/กำหนดเอง)
  const systemListAll = useMemo(() => {
    const fromLegacy = sessions.flatMap(s => s.tracking_list || []);
    const fromNew = flashItems.map(f => f.return_tracking).filter(Boolean);
    return [...new Set([...fromLegacy, ...fromNew])];
  }, [sessions, flashItems]);
  // map: tracking code -> วันที่ Flash แจ้ง (session_date ของ session ที่มีโค้ดนี้) — รวมทั้งสองแหล่ง
  const codeToSessionDate = useMemo(() => {
    const map = {};
    const sessionDateById = {};
    sessions.forEach(s => { sessionDateById[s.id] = s.session_date; });
    sessions.forEach(s => {
      (s.tracking_list || []).forEach(code => {
        if (!map[code]) map[code] = s.session_date;
      });
    });
    flashItems.forEach(f => {
      if (f.return_tracking && !map[f.return_tracking]) map[f.return_tracking] = sessionDateById[f.session_id];
    });
    return map;
  }, [sessions, flashItems]);
  const systemList = useMemo(() => {
    if (summaryFilter.mode === "all") return systemListAll;
    const from = summaryFilter.rangeFrom, to = summaryFilter.rangeTo;
    return systemListAll.filter(code => {
      const d = codeToSessionDate[code];
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [systemListAll, codeToSessionDate, summaryFilter.mode, summaryFilter.rangeFrom, summaryFilter.rangeTo]);
  // เรียงเลขขากลับ (Flash แจ้ง) ให้วันที่ล่าสุดขึ้นก่อน — ใช้แสดงผลในหน้าสรุปและ export
  const sortedSystemList = useMemo(() => {
    return [...systemList].sort((a, b) => (codeToSessionDate[b] || "").localeCompare(codeToSessionDate[a] || ""));
  }, [systemList, codeToSessionDate]);

  // scansFiltered: ถึงคลัง ในขอบเขตช่วงเวลาเดียวกัน (อิงวันที่ยิงรับเข้าคลัง)
  const scansFiltered = useMemo(() => {
    if (summaryFilter.mode === "all") return scans;
    const from = summaryFilter.rangeFrom, to = summaryFilter.rangeTo;
    return scans.filter(sc => {
      const d = sc.scan_date || (sc.scanned_at ? sc.scanned_at.slice(0, 10) : null); // scan_date = วันที่ไทยตอนยิง, scanned_at เป็น UTC (เพี้ยนช่วงเที่ยงคืน–7 โมงเช้า)
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [scans, summaryFilter.mode, summaryFilter.rangeFrom, summaryFilter.rangeTo]);

  // สถานะ "ถึงคลังหรือยัง" ต้องเทียบกับการยิงทั้งหมดเสมอ — ไม่ผูกกับช่วงเวลาที่เลือกดู
  // เพราะของที่ Flash แจ้งปลายเดือน/เมื่อวาน มักถูกยิงรับเข้าคลังวันถัดไป ถ้ากรองด้วยช่วงเดียวกันจะขึ้นแดงปลอมทั้งชุด
  const scannedSet = useMemo(() => new Set(scans.map(sc => sc.tracking_code)), [scans]);
  const matched = useMemo(() => sortedSystemList.filter(c => scannedSet.has(c)), [sortedSystemList, scannedSet]);
  const missing = useMemo(() => sortedSystemList.filter(c => !scannedSet.has(c)), [sortedSystemList, scannedSet]);
  // ยิงเกิน: ของที่ยิงเข้าคลัง (ในช่วงที่เลือก) แต่ไม่มีอยู่ใน Flash แจ้ง "ทั้งหมด"
  // ใช้ systemListAll ไม่ใช่ systemList — ไม่งั้นของที่ Flash แจ้งข้ามเดือนจะถูกนับเป็นยิงเกินผิดๆ
  const systemSetAll = useMemo(() => new Set(systemListAll), [systemListAll]);
  const extra = useMemo(() => {
    const seen = new Set();
    return scansFiltered.filter(sc => {
      if (systemSetAll.has(sc.tracking_code)) return false;
      if (seen.has(sc.tracking_code)) return false;
      seen.add(sc.tracking_code);
      return true;
    });
  }, [scansFiltered, systemSetAll]);

  // ── panel ที่ 3: ตีกลับ myorder — เทียบ outbound_tracking ของ myorder กับ return_flash_items (เลขขาไปตรงกัน) ──
  const flashOutboundMap = useMemo(() => {
    const m = {};
    flashItems.forEach(f => { if (f.outbound_tracking && !m[f.outbound_tracking]) m[f.outbound_tracking] = f; });
    return m;
  }, [flashItems]);
  // map: เลขขากลับ -> เลขขาไป / เวลา (สำหรับแสดงผลและ export หน้าสรุป)
  const retToOutbound = useMemo(() => {
    const m = {};
    flashItems.forEach(f => { if (f.return_tracking && !m[f.return_tracking]) m[f.return_tracking] = f.outbound_tracking; });
    return m;
  }, [flashItems]);
  const retToTime = useMemo(() => {
    const m = {};
    flashItems.forEach(f => { if (f.return_tracking && !m[f.return_tracking]) m[f.return_tracking] = f.flash_time; });
    return m;
  }, [flashItems]);
  const myorderRows = useMemo(() => {
    return myorderItems.map(it => {
      const isWA = /^WA/i.test(it.outbound_tracking || "");
      if (isWA) {
        const scanned = scannedSet.has(it.outbound_tracking);
        return { ...it, returnTracking: it.outbound_tracking, scanned, isThaiPost: true };
      }
      const flash = flashOutboundMap[it.outbound_tracking];
      const returnTracking = flash?.return_tracking || null;
      const scanned = returnTracking ? scannedSet.has(returnTracking) : false;
      return { ...it, returnTracking, scanned, isThaiPost: false };
    });
  }, [myorderItems, flashOutboundMap, scannedSet]);
  // myorderRowsFiltered: เฉพาะรายการที่วันที่สั่งซื้ออยู่ในช่วงเวลาเดียวกัน (ตามตัวกรองหลัก) — fallback เป็นวันที่นำเข้าถ้าแปลงวันที่สั่งซื้อไม่ได้
  const myorderRowsFiltered = useMemo(() => {
    if (summaryFilter.mode === "all") return myorderRows;
    const from = summaryFilter.rangeFrom, to = summaryFilter.rangeTo;
    return myorderRows.filter(r => {
      const d = parseThaiOrderDate(r.order_date) || (r.imported_at ? r.imported_at.slice(0, 10) : null);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [myorderRows, summaryFilter.mode, summaryFilter.rangeFrom, summaryFilter.rangeTo]);
  const myorderMatched = myorderRowsFiltered.filter(r => r.scanned).length;
  const myorderPending = myorderRowsFiltered.length - myorderMatched;

  const pct = systemList.length > 0 ? Math.round((matched.length / systemList.length) * 100) : 0;

  // ── ตัวเลือกช่วงเวลา (ตัวกรองหลัก — ใช้กรองทุกคอลัมน์: Flash แจ้ง / ถึงคลัง / ตีกลับ myorder) — ใช้ DateFilterRow ที่ใช้ร่วมกันทั้งระบบ ──

  const fmtTime = (iso) => iso ? new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-";

  const [exporting, setExporting] = useState(false);
  const filterLabel = (f) => {
    if (f.mode === "all") return "ทั้งหมด";
    if (f.mode === "thisMonth") return "เดือนนี้ (" + f.rangeFrom + " — " + f.rangeTo + ")";
    if (f.mode === "lastMonth") return "เดือนที่แล้ว (" + f.rangeFrom + " — " + f.rangeTo + ")";
    return `กำหนดเอง: ${f.from || "?"} — ${f.to || "?"}`;
  };

  const handleSummaryExport = async () => {
    setExporting(true);
    try {
      const XLSX = await loadXLSX();
      const HEADER = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "4F46E5" } } };
      const GREEN  = { fill: { fgColor: { rgb: "C6EFCE" } } };
      const RED    = { fill: { fgColor: { rgb: "FFCCCC" } } };
      const ORANGE = { fill: { fgColor: { rgb: "FFE0B2" } } };
      const wb = XLSX.utils.book_new();

      // Sheet 1: สรุปยอด
      const ws1 = XLSX.utils.aoa_to_sheet([
        [{ v: "รายงานสรุปรวมพัสดุตีกลับ", s: { font: { bold: true, sz: 14 } } }, ""],
        ["วันที่ออกรายงาน", new Date().toLocaleDateString("th-TH", { dateStyle: "long" })],
        ["ตัวกรอง (ใช้ร่วมกันทุกคอลัมน์)", filterLabel(summaryFilter)],
        ["", ""],
        [{ v: "รายการ", s: HEADER }, { v: "จำนวน (ชิ้น)", s: HEADER }],
        ["🗂 ตีกลับในระบบ (Flash แจ้ง ตามตัวกรอง)", sortedSystemList.length],
        ["📦 ตีกลับถึงคลัง (ตามตัวกรอง)", scansFiltered.length],
        [{ v: "✅ ตรงกัน", s: GREEN }, { v: matched.length, s: GREEN }],
        [{ v: "🔴 ยังไม่ถึงคลัง", s: RED }, { v: missing.length, s: RED }],
        [{ v: "⚠️ ยิงเกิน (ไม่อยู่ในระบบ)", s: ORANGE }, { v: extra.length, s: ORANGE }],
        ["📋 ตีกลับ myorder (ตามตัวกรอง)", myorderRowsFiltered.length],
        ["", ""],
        [{ v: `ความครบถ้วน: ${pct}%`, s: { font: { bold: true, color: { rgb: pct === 100 ? "007A3D" : "CC0000" } } } }, ""],
      ]);
      ws1["!cols"] = [{ wch: 36 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(wb, ws1, "สรุปยอด");

      // Sheet 2: ตีกลับในระบบ — Flash แจ้ง ทั้งหมดตามตัวกรอง วันที่ล่าสุดขึ้นก่อน
      const ws2 = XLSX.utils.aoa_to_sheet([
        [{ v: "เลขขาไป", s: HEADER }, { v: "เลขขากลับ (Flash)", s: HEADER }, { v: "เวลาเซ็นรับ", s: HEADER }, { v: "วันที่แจ้ง", s: HEADER }, { v: "สถานะ", s: HEADER }],
        ...sortedSystemList.map(code => {
          const ok = scannedSet.has(code);
          const dateLabel = codeToSessionDate[code] ? new Date(codeToSessionDate[code] + "T00:00:00").toLocaleDateString("th-TH") : "-";
          return [
            { v: retToOutbound[code] || "-", s: ok ? GREEN : RED },
            { v: code, s: ok ? GREEN : RED },
            { v: retToTime[code] || "-", s: ok ? GREEN : RED },
            { v: dateLabel, s: ok ? GREEN : RED },
            { v: ok ? "✅ ตรงกัน" : "🔴 ยังไม่ถึงคลัง", s: ok ? GREEN : RED },
          ];
        }),
      ]);
      ws2["!cols"] = [{ wch: 22 }, { wch: 22 }, { wch: 20 }, { wch: 16 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, ws2, "ตีกลับในระบบ");

      // Sheet 3: ตีกลับถึงคลัง — ตามตัวกรองช่วงเวลาเดียวกัน
      const ws3 = XLSX.utils.aoa_to_sheet([
        [{ v: "เลข Tracking", s: HEADER }, { v: "ผู้ยิง", s: HEADER }, { v: "เวลายิง", s: HEADER }, { v: "สถานะ", s: HEADER }],
        ...scansFiltered.map(sc => {
          const inSystem = systemSetAll.has(sc.tracking_code);
          return [
            { v: sc.tracking_code, s: inSystem ? GREEN : ORANGE },
            sc.scanned_by || "-",
            sc.scanned_at ? new Date(sc.scanned_at).toLocaleString("th-TH") : "-",
            { v: inSystem ? "✅ ตรงกับระบบ" : "⚠️ ไม่อยู่ในระบบ", s: inSystem ? GREEN : ORANGE },
          ];
        }),
      ]);
      ws3["!cols"] = [{ wch: 22 }, { wch: 16 }, { wch: 22 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, ws3, "ตีกลับถึงคลัง");

      // Sheet 4: ตีกลับ myorder — ตามตัวกรองช่วงเวลาเดียวกัน
      const ws4 = XLSX.utils.aoa_to_sheet([
        [{ v: "Order No.", s: HEADER }, { v: "ช่องทาง/เพจ", s: HEADER }, { v: "วันที่สั่งซื้อ", s: HEADER }, { v: "ชื่อลูกค้า", s: HEADER }, { v: "เบอร์โทร", s: HEADER }, { v: "สินค้า", s: HEADER }, { v: "เลขขาไป", s: HEADER }, { v: "ยอดเงิน (฿)", s: HEADER }, { v: "เลขขากลับ (Flash)", s: HEADER }, { v: "ยิงรับเข้าคลัง", s: HEADER }],
        ...myorderRowsFiltered.map(r => [
          r.order_no || "-",
          r.channel || "-",
          r.order_date || "-",
          r.customer_name || "-",
          r.phone || "-",
          r.product || "-",
          r.outbound_tracking || "-",
          Number(r.amount || 0),
          r.isThaiPost ? "📮 ไปรษณีย์ไทย (เลขเดียวกัน)" : (r.returnTracking || "ยังไม่มีจาก Flash"),
          { v: r.scanned ? "✅ ยิงแล้ว" : "❌ ยังไม่ยิง", s: r.scanned ? GREEN : RED },
        ]),
      ]);
      ws4["!cols"] = [{ wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 20 }, { wch: 18 }, { wch: 12 }, { wch: 22 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws4, "ตีกลับ myorder");

      XLSX.writeFile(wb, `return_summary_${todayStr()}.xlsx`);
    } catch (e) { alert("Export ไม่สำเร็จ: " + e.message); }
    setExporting(false);
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 4 }}>📊 สรุปรวม</h2>
          <p style={{ fontSize: 13, color: "#6B7280" }}>เทียบ Flash แจ้ง / พนักงานยิงถึงคลัง / ตีกลับ myorder — กรองช่วงเวลาเดียวกันทุกคอลัมน์</p>
        </div>
        <button onClick={handleSummaryExport} disabled={exporting}
          style={{ background: "#EDE9FE", color: "#7C3AED", border: "1px solid #DDD6FE", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>
          {exporting ? "⏳..." : "📥 Export Excel"}
        </button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Flash แจ้ง", value: systemList.length, color: "#6B7280", bg: "#F9FAFB" },
          { label: "ถึงคลัง", value: scansFiltered.length, color: "#111827", bg: "#F9FAFB" },
          { label: "✅ ตรงกัน", value: matched.length, color: "#065F46", bg: "#D1FAE5" },
          { label: "🔴 ยังไม่ถึงคลัง", value: missing.length, color: missing.length > 0 ? "#991B1B" : "#065F46", bg: missing.length > 0 ? "#FEE2E2" : "#D1FAE5" },
          { label: "⚠️ ยิงเกิน", value: extra.length, color: "#92400E", bg: "#FEF3C7" },
          { label: "📋 ตีกลับ myorder", value: myorderRowsFiltered.length, color: "#7C3AED", bg: "#F5F3FF" },
        ].map((s, i) => (
          <div key={i} style={{ background: s.bg, borderRadius: 14, padding: "16px 14px", textAlign: "center", border: "1px solid #E5E7EB" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: "#6B7280", marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      {systemList.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ height: 8, background: "#F3F4F6", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: pct === 100 ? "#10B981" : "linear-gradient(90deg,#7C3AED,#3B82F6)", borderRadius: 4, transition: "width 0.4s" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, color: "#6B7280" }}>
            <span>ความครบถ้วน (เทียบตามตัวกรองที่เลือก)</span>
            <span style={{ fontWeight: 700, color: pct === 100 ? "#10B981" : "#7C3AED" }}>{pct}%</span>
          </div>
        </div>
      )}

      {/* ตัวกรองวันที่หลัก — ใช้กรองทุกคอลัมน์ร่วมกัน */}
      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: 14, marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#7C3AED", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>📅 ช่วงเวลา (กรองทุกคอลัมน์: Flash แจ้ง / ถึงคลัง / ตีกลับ myorder)</div>
        <DateFilterRow filter={summaryFilter} accent="linear-gradient(135deg,#7C3AED,#3B82F6)" />
      </div>

      {/* ตัวกรองที่ 2: ยังไม่ถึงคลัง */}
      <div style={{ marginBottom: 20 }}>
        <button onClick={() => setShowMissingOnly(v => !v)}
          style={{
            background: showMissingOnly ? "#DC2626" : "#fff",
            color: showMissingOnly ? "#fff" : "#991B1B",
            border: "1.5px solid " + (showMissingOnly ? "#DC2626" : "#FECACA"),
            borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 700,
            cursor: "pointer", fontFamily: "'Sarabun', sans-serif",
          }}>
          {showMissingOnly ? "✕ ปิดมุมมอง" : "🔴 แสดงเฉพาะของยังไม่ถึงคลัง"}
        </button>
        {showMissingOnly && (
          <span style={{ marginLeft: 10, fontSize: 12, color: "#991B1B" }}>
            แสดง {missing.length} รายการที่ Flash แจ้งไว้ (ตามช่วงเวลาที่เลือก) แต่ยังไม่เจอในถึงคลัง
          </span>
        )}
      </div>

      {loading && <div style={{ textAlign: "center", padding: 40, color: "#6B7280" }}>กำลังโหลดข้อมูล...</div>}

      {/* มุมมอง "ยังไม่ถึงคลัง" — สีแดงทั้งหมด */}
      {!loading && showMissingOnly && (
        <div style={{ background: "#fff", border: "1.5px solid #FECACA", borderRadius: 16, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#991B1B", marginBottom: 12 }}>
            🔴 ยังไม่ถึงคลัง ({missing.length} รายการ)
          </div>
          {missing.length === 0 && <div style={{ color: "#10B981", fontSize: 14, textAlign: "center", padding: 24 }}>🎉 ไม่มีรายการตกค้าง — ตรงกันครบตามตัวกรองนี้</div>}
          {missing.map((code, i) => {
            const sessDate = codeToSessionDate[code];
            const sessDateLabel = sessDate ? new Date(sessDate + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }) : "";
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: "#FEF2F2", marginBottom: 6, border: "1px solid #FECACA" }}>
                <span style={{ fontSize: 14 }}>🔴</span>
                <span style={{ fontFamily: "monospace", fontSize: 13, color: "#991B1B", fontWeight: 700 }}>{code}</span>
                {sessDateLabel && <span style={{ fontSize: 10, color: "#991B1B", background: "#FFE4E4", borderRadius: 4, padding: "1px 6px" }}>📅 {sessDateLabel}</span>}
                <span style={{ fontSize: 11, color: "#991B1B", marginLeft: "auto" }}>ยังไม่รับ / ยังไม่ลงระบบ</span>
              </div>
            );
          })}
        </div>
      )}

      {/* มุมมองปกติ: สามคอลัมน์ — Flash แจ้ง / ถึงคลัง / ตีกลับ myorder */}
      {!loading && !showMissingOnly && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: 16 }}>
            <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 600, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
              Flash แจ้ง ({systemList.length})
            </div>
            <div style={{ maxHeight: 640, overflowY: "auto" }}>
              {sortedSystemList.map((code, i) => {
                const ok = scannedSet.has(code);
                const sessDate = codeToSessionDate[code];
                const sessDateLabel = sessDate ? new Date(sessDate + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }) : "";
                return (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #F3F4F6", fontSize: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "monospace", color: ok ? "#065F46" : "#991B1B" }}>{code}</span>
                      {sessDateLabel && <span style={{ fontSize: 10, color: "#9CA3AF", background: "#F3F4F6", borderRadius: 4, padding: "1px 5px" }}>📅 {sessDateLabel}</span>}
                    </div>
                    <span style={{ color: ok ? "#10B981" : "#DC2626", fontWeight: ok ? 400 : 700, fontSize: 11 }}>{ok ? "✓ ตรงกัน" : "🔴 ยังไม่ถึงคลัง"}</span>
                  </div>
                );
              })}
              {systemList.length === 0 && <div style={{ color: "#9CA3AF", fontSize: 13 }}>ไม่มีข้อมูล Flash แจ้งตามตัวกรองนี้</div>}
            </div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: 16 }}>
            <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 600, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
              ถึงคลัง ({scansFiltered.length})
            </div>
            <div style={{ maxHeight: 640, overflowY: "auto" }}>
              {scansFiltered.map((sc, i) => {
                const inSystem = systemSetAll.has(sc.tracking_code);
                return (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #F3F4F6", fontSize: 12 }}>
                    <span style={{ fontFamily: "monospace", color: inSystem ? "#065F46" : "#92400E" }}>{sc.tracking_code}</span>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 11, color: "#374151" }}>{sc.scanned_by || "-"}</div>
                      <div style={{ fontSize: 10, color: "#9CA3AF" }}>{fmtTime(sc.scanned_at)}</div>
                    </div>
                  </div>
                );
              })}
              {scansFiltered.length === 0 && <div style={{ color: "#9CA3AF", fontSize: 13 }}>ไม่มีข้อมูลถึงคลังตามตัวกรองนี้</div>}
            </div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: 16 }}>
            <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 600, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
              📋 ตีกลับ myorder ({myorderRowsFiltered.length})
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, fontSize: 11 }}>
              <span style={{ background: "#D1FAE5", color: "#065F46", borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>✅ {myorderMatched} เสร็จแล้ว</span>
              <span style={{ background: "#FEF3C7", color: "#92400E", borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>⏳ {myorderPending} รอดำเนินการ</span>
            </div>
            <div style={{ maxHeight: 600, overflowY: "auto" }}>
              {myorderRowsFiltered.map((r, i) => {
                const trackingDisplay = r.isThaiPost ? r.outbound_tracking : (r.returnTracking || r.outbound_tracking);
                return (
                  <div key={i} onClick={() => onGoToMyorder && onGoToMyorder(r.order_no)}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #F3F4F6", fontSize: 12, cursor: onGoToMyorder ? "pointer" : "default" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#FAFAFE"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontFamily: "monospace", color: "#7C3AED", textDecoration: "underline", textDecorationStyle: "dotted" }}>{r.order_no}</span>
                      <span style={{ fontFamily: "monospace", fontSize: 10, color: r.isThaiPost ? "#0EA5E9" : "#9CA3AF" }}>
                        {r.isThaiPost ? "📮 " : ""}{trackingDisplay}
                      </span>
                    </div>
                    <span style={{ color: r.scanned ? "#10B981" : "#92400E", fontWeight: 600, fontSize: 11 }}>{r.scanned ? "✓ เสร็จแล้ว" : "⏳ รอดำเนินการ"}</span>
                  </div>
                );
              })}
              {myorderRowsFiltered.length === 0 && <div style={{ color: "#9CA3AF", fontSize: 13 }}>ไม่มีข้อมูล myorder ตามตัวกรองนี้</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function ReturnAdminPanel() {
  const filter = useDateFilterState("all"); // ตัวกรองช่วงเวลา — ใช้กรองทั้งหน้า (Flash แจ้ง + สรุปยอด)
  const [loading, setLoading] = useState(false); // อัปโหลดไฟล์
  const [loadingList, setLoadingList] = useState(false);
  const [allFlashItems, setAllFlashItems] = useState([]); // return_flash_items ทั้งหมด (join session_date มาด้วย)
  const [allScans, setAllScans] = useState([]); // return_scans ทั้งหมด — ใช้คำนวณสรุปยอด
  const [clearing, setClearing] = useState(false);
  const [importMsg, setImportMsg] = useState(null);
  const fileInputRef = useRef(null);

  // ── วางข้อความจาก extension "N2P Flash ตีกลับ Copy" ──
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasting, setPasting] = useState(false);
  const pastePreview = useMemo(() => parseFlashItemsText(pasteText), [pasteText]);

  const loadAll = async () => {
    setLoadingList(true);
    try {
      const [sessionRows, scanRows] = await Promise.all([
        sbReturnAll("return_sessions", "select=*&order=session_date.desc"),
        loadAllScans(),
      ]);
      setAllScans(scanRows || []);
      const sessionIds = (sessionRows || []).map(s => s.id);
      if (sessionIds.length > 0) {
        const itemRows = await sbReturnAll("return_flash_items", `session_id=in.(${sessionIds.join(",")})&order=created_at.desc`);
        const sessionMap = {};
        (sessionRows || []).forEach(s => { sessionMap[s.id] = s.session_date; });
        setAllFlashItems(itemRows.map(it => ({ ...it, sessionDate: sessionMap[it.session_id] })));
      } else {
        setAllFlashItems([]);
      }
    } catch (e) { console.error(e); }
    setLoadingList(false);
  };

  useEffect(() => { loadAll(); }, []); // โหลดครั้งเดียว — เปลี่ยนช่วงเวลาแล้วกรองที่ฝั่ง client

  // items: เฉพาะรายการ Flash แจ้งตามช่วงเวลาที่เลือก (อิง sessionDate)
  const items = useMemo(() => {
    if (filter.mode === "all") return allFlashItems;
    const from = filter.rangeFrom, to = filter.rangeTo;
    return allFlashItems.filter(it => {
      const d = it.sessionDate;
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [allFlashItems, filter.mode, filter.rangeFrom, filter.rangeTo]);

  // เทียบกับการยิงทั้งหมดเสมอ (เหตุผลเดียวกับ ReturnSummaryPanel) — ตัวกรองช่วงเวลาใช้เลือกว่าจะ "ดู" Flash ชุดไหนเท่านั้น
  const scannedSet = useMemo(() => new Set(allScans.map(s => s.tracking_code)), [allScans]);
  const flashCodes = useMemo(() => [...new Set(items.map(it => it.return_tracking).filter(Boolean))], [items]);
  const matchedCount = useMemo(() => flashCodes.filter(c => scannedSet.has(c)).length, [flashCodes, scannedSet]);
  const missingCount = flashCodes.length - matchedCount;
  const pct = flashCodes.length > 0 ? Math.round((matchedCount / flashCodes.length) * 100) : 0;

  // ── อัปโหลดไฟล์ Excel "ตีกลับในระบบ" (export จาก Flash Express extension) — รองรับเลือกหลายไฟล์พร้อมกัน ──
  // คอลัมน์ที่ต้องการ: เลขพัสดุขาไป, เลขพัสดุขาตีกลับ, เวลาเซ็นรับ — หาตำแหน่งคอลัมน์จากหัวตาราง (ไม่พึ่งตำแหน่งคงที่)
  // กันอัปโหลดซ้ำ: เช็คเลขพัสดุขาตีกลับ (return_tracking) กับข้อมูลทั้งหมดในระบบก่อนบันทึก ข้ามรายการที่ซ้ำ (ทั้งซ้ำกับของเดิม และซ้ำข้ามไฟล์ที่เลือกมาด้วยกัน)
  const parseFlashListSheet = (aoa) => {
    if (aoa.length < 2) return [];
    const headerRow = (aoa[0] || []).map(h => String(h || "").trim());
    const findCol = (...names) => headerRow.findIndex(h => names.some(n => h.includes(n)));
    let idxOutbound = findCol("เลขพัสดุขาไป");
    let idxReturn = findCol("เลขพัสดุขาตีกลับ", "เลขพัสดุขากลับ");
    let idxTime = findCol("เวลาเซ็นรับ");
    // fallback: ถ้าหาหัวตารางไม่เจอ ใช้ตำแหน่งคงที่ตามไฟล์ export มาตรฐาน (C, D, E)
    if (idxOutbound === -1) idxOutbound = 2;
    if (idxReturn === -1) idxReturn = 3;
    if (idxTime === -1) idxTime = 4;
    return aoa.slice(1)
      .filter(r => r && String(r[idxOutbound] || "").trim() !== "" && String(r[idxReturn] || "").trim() !== "")
      .map(r => ({
        outbound: String(r[idxOutbound]).trim().toUpperCase(),
        returnCode: String(r[idxReturn]).trim().toUpperCase(),
        time: String(r[idxTime] || "").trim(),
      }));
  };

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setLoading(true);
    setImportMsg(null);
    try {
      const XLSX = await loadXLSX();
      let parsedRows = [];
      let badFiles = [];
      for (const file of files) {
        try {
          const buf = await file.arrayBuffer();
          const wb = XLSX.read(buf, { type: "array" });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
          const rows = parseFlashListSheet(aoa);
          if (rows.length === 0) { badFiles.push(file.name); continue; }
          parsedRows = parsedRows.concat(rows);
        } catch (errFile) {
          badFiles.push(file.name);
        }
      }

      if (parsedRows.length === 0) {
        setImportMsg({ type: "error", text: "ไม่พบข้อมูลในไฟล์ที่อัปโหลด — ตรวจสอบว่าเป็นไฟล์ export ตีกลับในระบบ" });
        setLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      // กันซ้ำ: เทียบเลขพัสดุขาตีกลับ (return_tracking) กับทั้งระบบ (ไม่ใช่แค่ตามตัวกรองที่แสดงอยู่) + กันซ้ำข้ามไฟล์ที่เลือกมาพร้อมกัน
      const existingReturnRows = await sbReturnAll("return_flash_items", "select=return_tracking");
      const existingReturnSet = new Set(existingReturnRows.map(r => r.return_tracking));
      const seenInFile = new Set();
      const newRows = [];
      let dupCount = 0;
      parsedRows.forEach(r => {
        if (existingReturnSet.has(r.returnCode) || seenInFile.has(r.returnCode)) { dupCount++; return; }
        seenInFile.add(r.returnCode);
        newRows.push(r);
      });

      if (newRows.length > 0) {
        // จัดกลุ่มตามวันที่ (จาก เวลาเซ็นรับ เช่น "2026-06-30 10:39") — สร้าง/ใช้ session ต่อวันที่
        const byDate = {};
        newRows.forEach(r => {
          const d = r.time.slice(0, 10) || todayStr();
          if (!byDate[d]) byDate[d] = [];
          byDate[d].push(r);
        });

        for (const [d, rows] of Object.entries(byDate)) {
          const [newSession] = await sbReturn("return_sessions", { method: "POST", body: JSON.stringify({ tracking_list: [], courier: "Flash", session_date: d }) });
          const sessionId = newSession?.id;
          if (!sessionId) throw new Error("สร้างเซสชันไม่สำเร็จ");
          const insertRows = rows.map(it => ({
            session_id: sessionId,
            outbound_tracking: it.outbound,
            return_tracking: it.returnCode,
            flash_time: it.time,
          }));
          const chunkSize = 200;
          for (let i = 0; i < insertRows.length; i += chunkSize) {
            const chunk = insertRows.slice(i, i + chunkSize);
            await sbReturn("return_flash_items", { method: "POST", body: JSON.stringify(chunk) });
          }
        }
      }

      const fileCountLabel = files.length > 1 ? `${files.length} ไฟล์` : "1 ไฟล์";
      setImportMsg({
        type: badFiles.length > 0 ? "error" : "success",
        text: `นำเข้าจาก ${fileCountLabel}: เพิ่มใหม่ ${newRows.length} รายการ${dupCount > 0 ? `, ข้ามรายการที่ซ้ำ ${dupCount} รายการ` : ""}${badFiles.length > 0 ? `, อ่านไม่ได้/ไม่มีข้อมูล ${badFiles.length} ไฟล์ (${badFiles.join(", ")})` : ""}`,
      });
      await loadAll();
    } catch (err) {
      setImportMsg({ type: "error", text: "นำเข้าไม่สำเร็จ: " + (err.message || String(err)) });
    }
    setLoading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── นำเข้าจากข้อความที่วาง (จาก extension "N2P Flash ตีกลับ Copy") ──
  // รูปแบบ: บรรทัดวันที่ DD/MM/YYYY (มีได้หลายบล็อก) ตามด้วย เลขขาไป(เลขขากลับ) เวลา
  // กันซ้ำแบบเดียวกับการอัปโหลดไฟล์ Excel: เทียบเลขขากลับกับทั้งระบบ + กันซ้ำภายในข้อความเดียวกัน
  // flash_time บันทึกเป็น "YYYY-MM-DD HH:MM" ให้รูปแบบเดียวกับที่มาจากไฟล์ Excel
  const handlePasteImport = async () => {
    const parsed = pastePreview.items;
    if (parsed.length === 0) {
      setImportMsg({ type: "error", text: "ไม่พบรายการในข้อความที่วาง — รูปแบบที่รองรับ เช่น TH12018TXP1D6B(TH27218XG6XE0A) 10:48" });
      setShowPasteModal(false);
      return;
    }
    setPasting(true);
    setImportMsg(null);
    try {
      const existingReturnRows = await sbReturnAll("return_flash_items", "select=return_tracking");
      const existingReturnSet = new Set(existingReturnRows.map(r => r.return_tracking));
      const seenInText = new Set();
      const newRows = [];
      let dupCount = 0;
      parsed.forEach(r => {
        if (existingReturnSet.has(r.returnCode) || seenInText.has(r.returnCode)) { dupCount++; return; }
        seenInText.add(r.returnCode);
        newRows.push(r);
      });

      if (newRows.length > 0) {
        // จัดกลุ่มตามวันที่ในข้อความ (ถ้าไม่มีบรรทัดวันที่เลย fallback เป็นวันนี้) — สร้าง session ต่อวันที่
        const byDate = {};
        newRows.forEach(r => {
          const d = r.date || todayStr();
          if (!byDate[d]) byDate[d] = [];
          byDate[d].push(r);
        });

        for (const [d, rows] of Object.entries(byDate)) {
          const [newSession] = await sbReturn("return_sessions", { method: "POST", body: JSON.stringify({ tracking_list: [], courier: "Flash", session_date: d }) });
          const sessionId = newSession?.id;
          if (!sessionId) throw new Error("สร้างเซสชันไม่สำเร็จ");
          const insertRows = rows.map(it => ({
            session_id: sessionId,
            outbound_tracking: it.outbound,
            return_tracking: it.returnCode,
            flash_time: it.time ? `${d} ${it.time}` : d,
          }));
          const chunkSize = 200;
          for (let i = 0; i < insertRows.length; i += chunkSize) {
            const chunk = insertRows.slice(i, i + chunkSize);
            await sbReturn("return_flash_items", { method: "POST", body: JSON.stringify(chunk) });
          }
        }
      }

      setImportMsg({
        type: "success",
        text: `นำเข้าจากข้อความ: เพิ่มใหม่ ${newRows.length} รายการ${dupCount > 0 ? `, ข้ามรายการที่ซ้ำ ${dupCount} รายการ` : ""}`,
      });
      setShowPasteModal(false);
      setPasteText("");
      await loadAll();
    } catch (err) {
      setImportMsg({ type: "error", text: "นำเข้าไม่สำเร็จ: " + (err.message || String(err)) });
    }
    setPasting(false);
  };

  const handleDeleteItem = async (id) => {
    if (!confirm("ลบรายการนี้ออกจากระบบ?")) return;
    try {
      await sbReturn(`return_flash_items?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      await loadAll();
    } catch (e) { alert("ลบไม่สำเร็จ"); }
  };

  const handleClearAll = async () => {
    if (items.length === 0) return;
    if (!confirm(`ลบรายการ Flash ที่แสดงอยู่ทั้งหมด ${items.length} รายการ?\n(ใช้สำหรับล้างข้อมูลก่อนอัปโหลดไฟล์ชุดใหม่)`)) return;
    setClearing(true);
    try {
      const ids = items.map(it => it.id);
      // ลบเป็น batch ผ่าน in.() กันกรณีมีจำนวนมาก
      const chunkSize = 200;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        await sbReturn(`return_flash_items?id=in.(${chunk.join(",")})`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      }
      await loadAll();
    } catch (e) { alert("ลบไม่สำเร็จ: " + (e.message || JSON.stringify(e))); }
    setClearing(false);
  };

  // ── ลบข้อมูลเก่า (legacy): return_sessions ที่ยังใช้ tracking_list แบบ flat array ──
  // เก็บ return_scans (ประวัติการยิงจริง) ไว้ทั้งหมด แค่ตัดการเชื่อมโยง (session_id = NULL) ก่อนลบ session ทิ้ง
  const [legacyCount, setLegacyCount] = useState(null); // null = ยังไม่เช็ค, number = จำนวนที่เจอ
  const [clearingLegacy, setClearingLegacy] = useState(false);

  const checkLegacyCount = async () => {
    try {
      const all = await sbReturnAll("return_sessions", "select=id,tracking_list");
      const legacy = all.filter(s => Array.isArray(s.tracking_list) && s.tracking_list.length > 0);
      setLegacyCount(legacy.length);
      return legacy;
    } catch (e) { console.error(e); return []; }
  };

  useEffect(() => { checkLegacyCount(); }, []);

  const handleClearLegacy = async () => {
    const legacy = await checkLegacyCount();
    if (legacy.length === 0) { alert("ไม่พบข้อมูลเก่า (legacy) ในระบบแล้ว"); return; }
    if (!confirm(`พบ session เก่า (แบบ tracking_list) ${legacy.length} รายการ\nจะลบ session เหล่านี้ทิ้ง — ประวัติการยิงจริง (return_scans) จะยังเก็บไว้ ไม่ถูกลบ\n\nยืนยันลบ?`)) return;
    setClearingLegacy(true);
    try {
      const legacyIds = legacy.map(s => s.id);
      const chunkSize = 100;
      // 1) ตัดการเชื่อมโยง return_scans ของ session เก่าก่อน (set session_id = NULL) เพื่อกัน FK constraint และเก็บประวัติไว้
      for (let i = 0; i < legacyIds.length; i += chunkSize) {
        const chunk = legacyIds.slice(i, i + chunkSize);
        await sbReturn(`return_scans?session_id=in.(${chunk.join(",")})`, { method: "PATCH", body: JSON.stringify({ session_id: null }), headers: { Prefer: "return=minimal" } });
      }
      // 2) ลบ return_flash_items ที่อาจผูกกับ session เก่า (เผื่อมี) ก่อนลบ session
      for (let i = 0; i < legacyIds.length; i += chunkSize) {
        const chunk = legacyIds.slice(i, i + chunkSize);
        await sbReturn(`return_flash_items?session_id=in.(${chunk.join(",")})`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      }
      // 3) ลบ session เก่าทิ้ง
      for (let i = 0; i < legacyIds.length; i += chunkSize) {
        const chunk = legacyIds.slice(i, i + chunkSize);
        await sbReturn(`return_sessions?id=in.(${chunk.join(",")})`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      }
      await checkLegacyCount();
      await loadAll();
      alert(`ลบข้อมูลเก่าเรียบร้อย ${legacy.length} session — ประวัติการยิงยังอยู่ครบ`);
    } catch (e) { alert("ลบไม่สำเร็จ: " + (e.message || JSON.stringify(e))); }
    setClearingLegacy(false);
  };

  return (
    <div>
      {/* Import section — อัปโหลดไฟล์ Excel / วางข้อความ ตีกลับในระบบ (ขึ้นมาด้านบน) */}
      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 20, padding: 20, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, flexWrap: "wrap", gap: 10 }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 2 }}>ตีกลับในระบบ</h2>
            <p style={{ fontSize: 13, color: "#6B7280" }}>อัปโหลดไฟล์ Excel (เลือกได้หลายไฟล์) หรือวางข้อความจากปุ่ม Copy ของ extension — เก็บเลขขาไป / เลขขากลับ / เวลาเซ็นรับ ระบบจะกรองรายการที่ซ้ำให้อัตโนมัติ</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" multiple style={{ display: "none" }} onChange={handleFileChange} />
            <button onClick={() => setShowPasteModal(true)} disabled={loading || pasting}
              style={{ background: "#EDE9FE", color: "#7C3AED", border: "1px solid #DDD6FE", borderRadius: 10, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: loading || pasting ? "not-allowed" : "pointer", fontFamily: "'Sarabun', sans-serif" }}>
              📋 วางข้อความ
            </button>
            <button onClick={() => fileInputRef.current?.click()} disabled={loading || pasting}
              style={{ background: loading ? "#F3F4F6" : "linear-gradient(135deg,#7C3AED,#3B82F6)", color: loading ? "#9CA3AF" : "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: loading || pasting ? "not-allowed" : "pointer", fontFamily: "'Sarabun', sans-serif" }}>
              {loading ? "⏳ กำลังนำเข้า..." : "📤 อัปโหลดไฟล์ Excel"}
            </button>
          </div>
        </div>

        {importMsg && (
          <div style={{ background: importMsg.type === "success" ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${importMsg.type === "success" ? "#BBF7D0" : "#FECACA"}`, color: importMsg.type === "success" ? "#065F46" : "#991B1B", borderRadius: 10, padding: "10px 16px", marginTop: 14, fontSize: 13 }}>
            {importMsg.type === "success" ? "✅ " : "⚠️ "}{importMsg.text}
          </div>
        )}
      </div>

      {/* สรุปยอด — ตามช่วงเวลาที่เลือก */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 16 }}>
        {[
          { label: "Flash แจ้ง", value: flashCodes.length, color: "#6B7280", bg: "#F9FAFB" },
          { label: "✅ ตรงกัน", value: matchedCount, color: "#065F46", bg: "#D1FAE5" },
          { label: "🔴 ยังไม่ถึงคลัง", value: missingCount, color: missingCount > 0 ? "#991B1B" : "#065F46", bg: missingCount > 0 ? "#FEE2E2" : "#D1FAE5" },
          { label: "ความครบถ้วน", value: `${pct}%`, color: pct === 100 ? "#065F46" : "#7C3AED", bg: pct === 100 ? "#D1FAE5" : "#F5F3FF" },
        ].map((s, i) => (
          <div key={i} style={{ background: s.bg, borderRadius: 12, padding: "12px 14px", textAlign: "center", border: "1px solid #E5E7EB" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#6B7280", marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ตัวกรองช่วงเวลา */}
      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: 14, marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#7C3AED", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>📅 ช่วงเวลา</div>
        <DateFilterRow filter={filter} accent="linear-gradient(135deg,#7C3AED,#3B82F6)" />
      </div>

      {/* แบนเนอร์ข้อมูลเก่า (legacy) — แสดงเมื่อยังมี session เก่าแบบ tracking_list หลงเหลืออยู่ */}
      {legacyCount > 0 && (
        <div style={{ background: "#FFFBEB", border: "1.5px solid #FDE68A", borderRadius: 14, padding: "14px 18px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, color: "#92400E", fontSize: 14 }}>⚠️ พบข้อมูลเก่า (รูปแบบก่อนใช้ไฟล์อัปโหลด)</div>
            <div style={{ fontSize: 12, color: "#92400E", marginTop: 3 }}>
              มี session เก่า {legacyCount} รายการที่ยังเป็นเลขแบบไม่จับคู่ — ทำให้ไม่ชนกับ "ตีกลับ myorder" ได้ แนะนำให้ลบทิ้ง (ประวัติการยิงจริงจะไม่ถูกลบ)
            </div>
          </div>
          <button onClick={handleClearLegacy} disabled={clearingLegacy}
            style={{ background: "#DC2626", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>
            {clearingLegacy ? "⏳ กำลังลบ..." : `🗑️ ลบข้อมูลเก่าทั้งหมด (${legacyCount})`}
          </button>
        </div>
      )}

      {/* ลิสต์ FLASH แจ้ง — เลขขาไป + เลขขากลับ + เวลา (ขยายให้ยาวขึ้น) */}
      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
            FLASH แจ้ง ({items.length})
          </div>
          {items.length > 0 && (
            <button onClick={handleClearAll} disabled={clearing}
              style={{ background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>
              {clearing ? "⏳ กำลังลบ..." : `🗑️ ล้างรายการที่แสดง (${items.length})`}
            </button>
          )}
        </div>
        {loadingList && <div style={{ textAlign: "center", padding: 40, color: "#6B7280" }}>กำลังโหลดข้อมูล...</div>}
        {!loadingList && (
          <div style={{ maxHeight: 900, overflowY: "auto" }}>
            {items.map((it) => {
              const dateLabel = it.sessionDate ? new Date(it.sessionDate + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }) : "";
              const ok = it.return_tracking ? scannedSet.has(it.return_tracking) : false;
              return (
                <div key={it.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #F3F4F6", fontSize: 13, gap: 8 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ fontFamily: "monospace", color: "#111827" }}>{it.outbound_tracking}</span>
                    <span style={{ fontFamily: "monospace", fontSize: 11, color: "#7C3AED" }}>↳ {it.return_tracking} <span style={{ color: "#9CA3AF" }}>{it.flash_time}</span></span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: ok ? "#10B981" : "#DC2626" }}>{ok ? "✓ ตรงกัน" : "🔴 ยังไม่ถึงคลัง"}</span>
                    {dateLabel && <span style={{ fontSize: 11, color: "#6B7280", background: "#F3F4F6", borderRadius: 4, padding: "2px 8px" }}>📅 {dateLabel}</span>}
                    <button onClick={() => handleDeleteItem(it.id)}
                      style={{ background: "none", border: "none", color: "#D1D5DB", cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1 }}
                      onMouseEnter={e => e.target.style.color="#EF4444"} onMouseLeave={e => e.target.style.color="#D1D5DB"}
                      title="ลบออกจากระบบ">✕</button>
                  </div>
                </div>
              );
            })}
            {items.length === 0 && <div style={{ color: "#9CA3AF", fontSize: 13, textAlign: "center", padding: 24 }}>ไม่มีข้อมูล Flash แจ้งตามตัวกรองนี้</div>}
          </div>
        )}
      </div>

      {/* MODAL: วางข้อความจาก extension "N2P Flash ตีกลับ Copy" */}
      {showPasteModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.5)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, backdropFilter: "blur(8px)" }}
          onClick={() => { if (!pasting) setShowPasteModal(false); }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 20, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto", padding: 24, boxShadow: "0 24px 60px rgba(0,0,0,0.15)" }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "#111827", marginBottom: 4 }}>📋 วางข้อความตีกลับในระบบ</h3>
            <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 14 }}>
              วางข้อความจากปุ่ม Copy ของ extension — บรรทัดวันที่ (DD/MM/YYYY) ตามด้วย เลขขาไป(เลขขากลับ) เวลา
            </p>
            <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} autoFocus
              placeholder={"08/07/2026\nTH12018TXP1D6B(TH27218XG6XE0A) 10:48\nTH45018T18B30L(TH27218XGENY0A) 10:49"}
              style={{ width: "100%", height: 260, background: "#F9FAFB", border: "1.5px solid #E5E7EB", borderRadius: 10, padding: "12px 14px", color: "#111827", fontSize: 12, outline: "none", fontFamily: "monospace", resize: "vertical", boxSizing: "border-box" }} />
            {/* พรีวิวผลการอ่านข้อความ — อัปเดตสดขณะวาง */}
            <div style={{ marginTop: 10, fontSize: 13 }}>
              {pasteText.trim() === "" ? (
                <span style={{ color: "#9CA3AF" }}>ยังไม่มีข้อความ — วางข้อความจาก extension ได้เลย</span>
              ) : pastePreview.items.length === 0 ? (
                <span style={{ color: "#DC2626" }}>⚠️ อ่านไม่พบรายการ — ตรวจสอบรูปแบบข้อความ</span>
              ) : (
                <span style={{ color: "#065F46" }}>
                  ✅ อ่านได้ {pastePreview.items.length} รายการ
                  {" · "}วันที่: {[...new Set(pastePreview.items.map(it => it.date || todayStr()))].map(d => new Date(d + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })).join(", ")}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
              <button onClick={() => setShowPasteModal(false)} disabled={pasting}
                style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", color: "#6B7280", borderRadius: 10, padding: "11px 18px", fontSize: 14, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>ยกเลิก</button>
              <button onClick={handlePasteImport} disabled={pasting || pastePreview.items.length === 0}
                style={{ background: pasting || pastePreview.items.length === 0 ? "#F3F4F6" : "linear-gradient(135deg,#7C3AED,#3B82F6)", color: pasting || pastePreview.items.length === 0 ? "#9CA3AF" : "#fff", border: "none", borderRadius: 10, padding: "11px 22px", fontSize: 14, fontWeight: 700, cursor: pasting || pastePreview.items.length === 0 ? "not-allowed" : "pointer", fontFamily: "'Sarabun', sans-serif" }}>
                {pasting ? "⏳ กำลังนำเข้า..." : `✅ นำเข้า ${pastePreview.items.length} รายการ`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



function ReturnStaffPanel() {
  const [staffName, setStaffName] = useState(localStorage.getItem("staffName") || "");
  const [mode, setMode] = useState("idle");
  const [staging, setStaging] = useState([]);
  const [submitted, setSubmitted] = useState([]);
  const [systemList, setSystemList] = useState([]); // เลขขากลับที่ Flash แจ้ง (ทั้งหมด ไม่จำกัดวัน) — รวมของเก่า+ใหม่ — ใช้ตรวจสอบขณะยิงสด
  const [flashItemsAll, setFlashItemsAll] = useState([]); // [{ return_tracking, sessionDate }] ทั้งหมด — ใช้กรองสรุปยอดตามช่วงเวลา (ไม่กระทบการยิงสด)
  const [myorderOutboundSet, setMyorderOutboundSet] = useState(new Set()); // outbound_tracking จาก myorder (สำหรับเทียบเลข WA)
  const historyFilter = useDateFilterState("all"); // ตัวกรองช่วงเวลา — ใช้กับสรุปยอด + ประวัติการยิงที่แสดงผลเท่านั้น ไม่กระทบการตรวจสอบขณะยิงสด
  const [scanInput, setScanInput] = useState("");
  const [lastScan, setLastScan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const scanRef = useRef(null);
  const listRef = useRef(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const scannerRef = useRef(null);
  const scannerDivId = "qr-scanner-div";
  const lastScannedRef = useRef("");
  const lastScannedTime = useRef(0);
  const stagingCodesRef = useRef([]);
  const submittedCodesRef = useRef([]);
  const today = todayStr();

  // เลขไปรษณีย์ไทย: เลขขึ้นต้นด้วย WA ใช้เลขเดียวกันทั้งขาไปและขากลับ
  const isThaiPostCode = (code) => /^WA/i.test(code || "");
  // เช็คว่าเลขนี้ "ตรงกัน" หรือยัง — WA เทียบกับ myorder ตรงๆ, อื่นๆ เทียบกับ systemList (Flash แจ้ง) ตามปกติ
  const isCodeMatched = (code, sysList, myorderSet) => {
    if (isThaiPostCode(code)) return myorderSet.has(code);
    return sysList.includes(code);
  };

  useEffect(() => { stagingCodesRef.current = staging.map(s => s.code); }, [staging]);
  useEffect(() => { submittedCodesRef.current = submitted.map(s => s.tracking_code); }, [submitted]);
  useEffect(() => { if (staffName) loadData(); }, [staffName]);
  useEffect(() => { if (mode === "scanning" && scanRef.current) scanRef.current.focus(); }, [mode]);
  useEffect(() => { return () => { closeCamera(); }; }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Flash แจ้ง — รวมของเก่า (tracking_list array) และของใหม่ (return_flash_items.return_tracking) ทั้งหมด ไม่จำกัดวัน
      const [sessions, flashRows, myorderRows] = await Promise.all([
        sbReturnAll("return_sessions", "select=id,tracking_list,session_date"),
        sbReturnAll("return_flash_items", "select=return_tracking,session_id"),
        sbReturnAll("return_myorder_items", "select=outbound_tracking"),
      ]);
      const fromLegacy = sessions.flatMap(s => s.tracking_list || []);
      const fromNew = flashRows.map(f => f.return_tracking).filter(Boolean);
      setSystemList([...new Set([...fromLegacy, ...fromNew])]);
      setMyorderOutboundSet(new Set(myorderRows.map(r => r.outbound_tracking).filter(Boolean)));

      // เก็บวันที่ Flash แจ้งต่อรหัส (สำหรับกรองสรุปยอดตามช่วงเวลาเท่านั้น — ไม่ใช้ตรวจสอบขณะยิงสด)
      const sessionDateById = {};
      sessions.forEach(s => { sessionDateById[s.id] = s.session_date; });
      const withDate = [];
      sessions.forEach(s => (s.tracking_list || []).forEach(code => withDate.push({ return_tracking: code, sessionDate: s.session_date })));
      flashRows.forEach(f => { if (f.return_tracking) withDate.push({ return_tracking: f.return_tracking, sessionDate: sessionDateById[f.session_id] }); });
      setFlashItemsAll(withDate);

      // ประวัติการยิงทั้งหมด ไม่จำกัดวัน
      const allScans = await sbReturnAll("return_scans", "select=tracking_code,scanned_by,scanned_at&order=scanned_at.desc");
      const seen = new Set();
      setSubmitted(allScans.filter(s => { if (seen.has(s.tracking_code)) return false; seen.add(s.tracking_code); return true; }));
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const playBeep = (ok) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = "sine"; o.frequency.value = ok ? 880 : 280;
      g.gain.setValueAtTime(0.3, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      o.start(); o.stop(ctx.currentTime + 0.3);
    } catch {}
  };

  const handleScanned = (code) => {
    code = code.trim().toUpperCase();
    if (!code) return;
    const now = Date.now();
    if (code === lastScannedRef.current && now - lastScannedTime.current < 1500) return;
    lastScannedRef.current = code;
    lastScannedTime.current = now;
    const allCodes = [...stagingCodesRef.current, ...submittedCodesRef.current];
    if (allCodes.includes(code)) { playBeep(false); setLastScan({ code, status: "duplicate" }); return; }
    const timeStr = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setStaging(prev => [{ code, time: timeStr }, ...prev]);
    const ok = isCodeMatched(code, systemList, myorderOutboundSet);
    setLastScan({ code, status: ok ? "match" : "extra" });
    playBeep(ok);
  };

  const handleScan = (e) => {
    if (e.key !== "Enter") return;
    const code = scanInput.trim().toUpperCase();
    if (!code) return;
    setScanInput("");
    const allCodes = [...stagingCodesRef.current, ...submittedCodesRef.current];
    if (allCodes.includes(code)) { playBeep(false); setLastScan({ code, status: "duplicate" }); return; }
    const timeStr = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setStaging(prev => [{ code, time: timeStr }, ...prev]);
    const ok = isCodeMatched(code, systemList, myorderOutboundSet);
    setLastScan({ code, status: ok ? "match" : "extra" });
    playBeep(ok);
    setTimeout(() => { if (listRef.current) listRef.current.scrollTop = 0; }, 50);
  };

  const loadHtml5Qr = () => new Promise((resolve, reject) => {
    if (window.Html5Qrcode) { resolve(); return; }
    const s = document.createElement("script");
    s.src = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";
    s.onload = resolve; s.onerror = () => reject(new Error("โหลดไม่สำเร็จ"));
    document.head.appendChild(s);
  });

  const openCamera = async () => {
    setCameraLoading(true);
    try {
      await loadHtml5Qr();
      setCameraOpen(true);
      await new Promise(r => setTimeout(r, 200));
      const scanner = new window.Html5Qrcode(scannerDivId);
      scannerRef.current = scanner;
      await scanner.start({ facingMode: "environment" },
        { fps: 15, qrbox: { width: 280, height: 120 }, aspectRatio: 1.8 },
        handleScanned, () => {}
      );
    } catch (err) {
      setCameraOpen(false);
      alert("เปิดกล้องไม่ได้ กรุณาอนุญาต permission กล้องในการตั้งค่าเบราว์เซอร์");
    }
    setCameraLoading(false);
  };

  const closeCamera = async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); scannerRef.current.clear(); } catch {}
      scannerRef.current = null;
    }
    setCameraOpen(false);
  };

  const removeFromStaging = (code) => {
    setStaging(prev => prev.filter(s => s.code !== code));
    if (lastScan?.code === code) setLastScan(null);
  };

  const handleConfirm = async () => {
    if (staging.length === 0) return;
    setSaving(true);
    try {
      const sessions = await sbReturnAll("return_sessions", `select=id,tracking_list&session_date=eq.${today}`);
      // ถ้าไม่มีเซสชันวันนี้ สร้างใหม่อัตโนมัติ
      let fallbackId = sessions[0]?.id ?? null;
      if (!fallbackId) {
        const [newSession] = await sbReturn("return_sessions", { method: "POST", body: JSON.stringify({ tracking_list: [], courier: "Flash", session_date: today }) });
        fallbackId = newSession?.id;
      }
      const now = new Date().toISOString();
      for (const entry of staging) {
        const target = sessions.find(s => (s.tracking_list||[]).includes(entry.code));
        const sid = target?.id || fallbackId;
        if (sid) {
          try {
            await sbReturn("return_scans", { method: "POST", body: JSON.stringify({ tracking_code: entry.code, session_id: sid, scanned_by: staffName, scanned_at: now, scan_date: today }) });
          } catch {}
        }
      }
      const newSubmitted = staging.map(s => ({ tracking_code: s.code, scanned_by: staffName, scanned_at: now }));
      setSubmitted(prev => [...newSubmitted, ...prev]);
      setStaging([]); setLastScan(null); setMode("idle");
      await loadData();
    } catch (e) { alert("บันทึกไม่สำเร็จ"); }
    setSaving(false);
  };

  const handleCancel = () => {
    if (staging.length > 0 && !confirm(`ยกเลิกการยิง ${staging.length} รายการ?`)) return;
    setStaging([]); setLastScan(null); setMode("idle");
  };

  const allCodes = [...new Set([...submitted.map(s=>s.tracking_code), ...staging.map(s=>s.code)])];
  const scannedSet = new Set(allCodes);
  const matched = systemList.filter(c => scannedSet.has(c));
  const missing = systemList.filter(c => !scannedSet.has(c));
  // ยิงเกิน: ไม่อยู่ใน Flash แจ้ง (systemList) และไม่ใช่ WA ที่ตรงกับ myorder
  const extra = allCodes.filter(c => !systemList.includes(c) && !(isThaiPostCode(c) && myorderOutboundSet.has(c)));
  const progress = systemList.length > 0 ? Math.round(matched.length / systemList.length * 100) : 0;

  // ── สรุปยอดตามช่วงเวลาที่เลือก (historyFilter) — ใช้แสดงผลเท่านั้น ไม่กระทบการตรวจสอบขณะยิงสดด้านบน ──
  const flashCodesInRange = useMemo(() => {
    if (historyFilter.mode === "all") return [...new Set(flashItemsAll.map(f => f.return_tracking))];
    const from = historyFilter.rangeFrom, to = historyFilter.rangeTo;
    const set = new Set();
    flashItemsAll.forEach(f => {
      const d = f.sessionDate;
      if (!d) return;
      if (from && d < from) return;
      if (to && d > to) return;
      set.add(f.return_tracking);
    });
    return [...set];
  }, [flashItemsAll, historyFilter.mode, historyFilter.rangeFrom, historyFilter.rangeTo]);
  const submittedFiltered = useMemo(() => {
    if (historyFilter.mode === "all") return submitted;
    const from = historyFilter.rangeFrom, to = historyFilter.rangeTo;
    return submitted.filter(s => {
      const d = s.scanned_at ? s.scanned_at.slice(0, 10) : null;
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [submitted, historyFilter.mode, historyFilter.rangeFrom, historyFilter.rangeTo]);
  const scannedSetInRange = useMemo(() => new Set(submittedFiltered.map(s => s.tracking_code)), [submittedFiltered]);
  const matchedInRange = useMemo(() => flashCodesInRange.filter(c => scannedSetInRange.has(c)), [flashCodesInRange, scannedSetInRange]);
  const missingInRangeCount = flashCodesInRange.length - matchedInRange.length;
  const pctInRange = flashCodesInRange.length > 0 ? Math.round((matchedInRange.length / flashCodesInRange.length) * 100) : 0;

  const handleStaffExport = async () => {
    setExporting(true);
    try {
      const XLSX = await loadXLSX();
      const dateStr = new Date().toLocaleDateString("th-TH", { dateStyle: "long" });
      const HEADER = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "4F46E5" } } };
      const GREEN = { fill: { fgColor: { rgb: "C6EFCE" } } };
      const RED   = { fill: { fgColor: { rgb: "FFCCCC" } } };
      const ORANGE= { fill: { fgColor: { rgb: "FFE0B2" } } };
      const wb = XLSX.utils.book_new();
      const pct = systemList.length > 0 ? Math.round(matched.length/systemList.length*100) : 0;
      const ws1 = XLSX.utils.aoa_to_sheet([
        [{ v: "สรุปรายงานพัสดุตีกลับ", s: { font: { bold: true, sz: 14 } } }, ""],
        ["วันที่", dateStr], ["ผู้ยิง", staffName], ["",""],
        [{ v:"หัวข้อ",s:HEADER},{v:"จำนวน",s:HEADER}],
        ["1. Flash แจ้ง", systemList.length],
        ["2. ถึงคลัง", submitted.length],
        [{ v:"3. ✅ ตรงกัน",s:GREEN},matched.length],
        [{ v:"4. ❌ รอรับ",s:missing.length>0?RED:{}},missing.length],
        [{ v:"5. ⚠️ ยิงเกิน",s:extra.length>0?ORANGE:{}},extra.length],
        ["",""],
        [{ v:`ความครบถ้วน: ${pct}%`,s:{font:{bold:true,color:{rgb:pct===100?"007A3D":"CC0000"}}}}, ""],
      ]);
      ws1["!cols"]=[{wch:36},{wch:14}];
      XLSX.utils.book_append_sheet(wb, ws1, "สรุปยอด");
      XLSX.writeFile(wb, `return_staff_${today}.xlsx`);
    } catch (e) { alert("Export ไม่สำเร็จ: " + e.message); }
    setExporting(false);
  };

  if (!staffName) return (
    <div style={{ textAlign: "center", paddingTop: 60 }}>
      <div style={{ fontSize: 36, marginBottom: 16 }}>👤</div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "#111827", marginBottom: 8 }}>ระบุชื่อพนักงานก่อน</h2>
      <p style={{ color: "#6B7280", fontSize: 14, marginBottom: 24 }}>ใช้บันทึกว่าใครยิงบาร์โค้ด</p>
      <input placeholder="ชื่อพนักงาน" autoFocus
        style={{ background: "#F9FAFB", border: "1.5px solid #E5E7EB", borderRadius: 10, padding: "10px 16px", color: "#111827", fontSize: 15, outline: "none", fontFamily: "'Sarabun', sans-serif", width: 240, textAlign: "center" }}
        onKeyDown={e => { if (e.key === "Enter" && e.target.value.trim()) { const n = e.target.value.trim(); setStaffName(n); localStorage.setItem("staffName", n); } }} />
      <div style={{ color: "#9CA3AF", fontSize: 13, marginTop: 10 }}>กด Enter เพื่อยืนยัน</div>
    </div>
  );

  if (loading) return <div style={{ textAlign: "center", paddingTop: 60, color: "#6B7280" }}>กำลังโหลดข้อมูลวันนี้...</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 2 }}>ตีกลับถึงคลัง — ยิงบาร์โค้ด</h2>
          <div style={{ fontSize: 12, color: "#6B7280" }}>
            <span style={{ color: "#7C3AED", fontWeight: 600 }}>{staffName}</span> · {new Date().toLocaleDateString("th-TH", { dateStyle: "long" })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleStaffExport} disabled={exporting}
            style={{ background: "#EDE9FE", border: "1px solid #DDD6FE", color: "#7C3AED", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>
            {exporting ? "⏳..." : "📥 Export"}
          </button>
          <button onClick={loadData} style={{ background: "#fff", border: "1px solid #E5E7EB", color: "#6B7280", borderRadius: 8, padding: "7px 14px", fontSize: 13, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>🔄</button>
          <button onClick={() => { localStorage.removeItem("staffName"); setStaffName(""); }} style={{ background: "transparent", border: "1px solid #E5E7EB", color: "#9CA3AF", borderRadius: 8, padding: "7px 14px", fontSize: 13, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>เปลี่ยนชื่อ</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
        {[
          { label: "Flash แจ้ง", value: systemList.length, color: "#6B7280", bg: "#F9FAFB" },
          { label: "ถึงคลังแล้ว", value: submitted.length, color: "#111827", bg: "#F9FAFB" },
          { label: "✅ ตรง", value: matched.length, color: "#065F46", bg: "#D1FAE5" },
          { label: missing.length > 0 ? "❌ รอรับ" : extra.length > 0 ? "⚠️ เกิน" : "✅ ครบ!",
            value: missing.length > 0 ? missing.length : extra.length > 0 ? extra.length : "🎉",
            color: missing.length > 0 ? "#991B1B" : extra.length > 0 ? "#92400E" : "#065F46",
            bg: missing.length > 0 ? "#FEE2E2" : extra.length > 0 ? "#FEF3C7" : "#D1FAE5" },
        ].map((s, i) => (
          <div key={i} style={{ background: s.bg, border: "1px solid #E5E7EB", borderRadius: 12, padding: "12px 14px", textAlign: "center" }}>
            <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#6B7280", marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {systemList.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ height: 6, background: "#F3F4F6", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress}%`, background: progress === 100 ? "#10B981" : "linear-gradient(90deg,#7C3AED,#3B82F6)", borderRadius: 3, transition: "width 0.3s" }} />
          </div>
          <div style={{ fontSize: 12, color: "#6B7280", marginTop: 3, textAlign: "right" }}>{progress}%</div>
        </div>
      )}

      {systemList.length === 0 && myorderOutboundSet.size === 0 && (
        <div style={{ background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 12, padding: "12px 16px", marginBottom: 14, fontSize: 13, color: "#92400E" }}>
          ⚠️ ยังไม่มีข้อมูล Flash แจ้ง / myorder ในระบบ — ยิงได้เลย ระบบจะแมทให้อัตโนมัติเมื่อมีข้อมูลเข้ามา
        </div>
      )}

      {/* ตัวกรองช่วงเวลา + สรุปยอดตามช่วงเวลา — ใช้กับประวัติด้านล่างเท่านั้น ไม่กระทบการตรวจสอบขณะยิงสดด้านบน */}
      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#7C3AED", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>📅 ช่วงเวลา (สำหรับสรุปยอด/ประวัติด้านล่าง)</div>
        <DateFilterRow filter={historyFilter} accent="linear-gradient(135deg,#7C3AED,#3B82F6)" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 16 }}>
        {[
          { label: "Flash แจ้ง", value: flashCodesInRange.length, color: "#6B7280", bg: "#F9FAFB" },
          { label: "✅ ตรงกัน", value: matchedInRange.length, color: "#065F46", bg: "#D1FAE5" },
          { label: "🔴 ยังไม่ถึงคลัง", value: missingInRangeCount, color: missingInRangeCount > 0 ? "#991B1B" : "#065F46", bg: missingInRangeCount > 0 ? "#FEE2E2" : "#D1FAE5" },
          { label: "ความครบถ้วน", value: `${pctInRange}%`, color: pctInRange === 100 ? "#065F46" : "#7C3AED", bg: pctInRange === 100 ? "#D1FAE5" : "#F5F3FF" },
        ].map((s, i) => (
          <div key={i} style={{ background: s.bg, borderRadius: 12, padding: "12px 14px", textAlign: "center", border: "1px solid #E5E7EB" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#6B7280", marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <button onClick={() => { setMode("scanning"); setStaging([]); setLastScan(null); }}
          style={{ background: "linear-gradient(135deg,#7C3AED,#3B82F6)", color: "#fff", border: "none", borderRadius: 12, padding: "13px 36px", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "'Sarabun', sans-serif", boxShadow: "0 8px 20px rgba(124,58,237,0.3)" }}>
          📦 เริ่มยิงบาร์โค้ด
        </button>
      </div>

      {/* ประวัติการยิง — ตามช่วงเวลาที่เลือก, ขยายเต็มหน้า */}
      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: 16 }}>
        <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 600, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>📜 ประวัติการยิง ({submittedFiltered.length})</div>
        <div style={{ maxHeight: 900, overflowY: "auto" }}>
          {submittedFiltered.map((s, i) => {
            const ok = isCodeMatched(s.tracking_code, systemList, myorderOutboundSet);
            const isWA = isThaiPostCode(s.tracking_code);
            return (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #F3F4F6", opacity: ok ? 0.55 : 1, textDecoration: ok ? "line-through" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: "monospace", fontSize: 12, color: ok ? "#065F46" : "#92400E" }}>{s.tracking_code}</span>
                  {isWA && <span style={{ fontSize: 10, color: "#0EA5E9", background: "#E0F2FE", borderRadius: 4, padding: "1px 6px" }}>ไปรษณีย์ไทย</span>}
                </div>
                <span style={{ fontSize: 11, color: "#6B7280" }}>
                  {s.scanned_by} · {s.scanned_at ? new Date(s.scanned_at).toLocaleDateString("th-TH", { day: "numeric", month: "short" }) + " " + new Date(s.scanned_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : ""}
                </span>
              </div>
            );
          })}
          {submittedFiltered.length === 0 && <div style={{ color: "#9CA3AF", fontSize: 13, textAlign: "center", padding: 24 }}>ไม่มีประวัติการยิงตามช่วงเวลานี้</div>}
        </div>
      </div>

      {mode === "scanning" && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.5)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, backdropFilter: "blur(8px)" }}>
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 20, width: "100%", maxWidth: 520, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,0.15)" }}>
            <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid #F3F4F6" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, color: "#111827", fontSize: 17 }}>📦 ยิงบาร์โค้ด</div>
                  <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>รอยืนยัน <span style={{ color: "#7C3AED", fontWeight: 700 }}>{staging.length}</span> รายการ</div>
                </div>
                <div style={{ fontFamily: "monospace", fontSize: 28, fontWeight: 700, color: "#7C3AED" }}>{staging.length}</div>
              </div>
              <input ref={scanRef} value={scanInput} onChange={e => setScanInput(e.target.value)} onKeyDown={handleScan}
                placeholder="ยิงบาร์โค้ดที่นี่..."
                style={{ width: "100%", background: "#F9FAFB", border: `2px solid ${lastScan?.status === "match" ? "#10B981" : lastScan?.status === "duplicate" ? "#F59E0B" : lastScan?.status === "extra" ? "#F59E0B" : "#E5E7EB"}`, borderRadius: 10, padding: "12px 14px", color: "#111827", fontSize: 14, outline: "none", fontFamily: "monospace", transition: "border-color 0.2s" }} />
              {lastScan && (
                <div style={{ marginTop: 8, padding: "7px 12px", borderRadius: 8, background: lastScan.status === "match" ? "#F0FDF4" : "#FFFBEB", border: `1px solid ${lastScan.status === "match" ? "#BBF7D0" : "#FDE68A"}`, display: "flex", alignItems: "center", gap: 10 }}>
                  <span>{lastScan.status === "match" ? "✅" : lastScan.status === "duplicate" ? "⚠️" : "📌"}</span>
                  <div>
                    <span style={{ fontFamily: "monospace", fontSize: 12, color: "#111827" }}>{lastScan.code}</span>
                    <span style={{ fontSize: 11, color: lastScan.status === "match" ? "#065F46" : "#92400E", marginLeft: 10 }}>
                      {lastScan.status === "match" ? "✓ อยู่ในรายการ" : lastScan.status === "duplicate" ? "⚠ ยิงซ้ำ" : "📌 บันทึกไว้ก่อน"}
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div style={{ padding: "8px 20px" }}>
              {!cameraOpen ? (
                <button onClick={openCamera} disabled={cameraLoading}
                  style={{ width: "100%", background: "#EDE9FE", border: "1px solid #DDD6FE", color: "#7C3AED", borderRadius: 10, padding: "10px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>
                  {cameraLoading ? "⏳ กำลังเปิดกล้อง..." : "📷 เปิดกล้องสแกน"}
                </button>
              ) : (
                <div>
                  <div id={scannerDivId} style={{ borderRadius: 10, overflow: "hidden", background: "#000" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                    <div style={{ fontSize: 12, color: "#6B7280" }}>🟢 กำลังสแกน</div>
                    <button onClick={closeCamera} style={{ background: "#FEE2E2", border: "1px solid #FECACA", color: "#DC2626", borderRadius: 6, padding: "3px 10px", fontSize: 12, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>✕ ปิดกล้อง</button>
                  </div>
                </div>
              )}
            </div>
            <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "8px 20px" }}>
              {staging.length === 0 && <div style={{ color: "#9CA3AF", fontSize: 13, textAlign: "center", paddingTop: 20 }}>ยังไม่มีรายการ — เริ่มยิงได้เลย</div>}
              {staging.map((entry, i) => {
                const ok = isCodeMatched(entry.code, systemList, myorderOutboundSet);
                return (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #F3F4F6" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span>{ok ? "✅" : "📌"}</span>
                      <div>
                        <div style={{ fontFamily: "monospace", fontSize: 13, color: ok ? "#065F46" : "#92400E", fontWeight: 600 }}>{entry.code}</div>
                        <div style={{ fontSize: 10, color: "#9CA3AF" }}>{entry.time}</div>
                      </div>
                    </div>
                    <button onClick={() => removeFromStaging(entry.code)} style={{ background: "none", border: "none", color: "#D1D5DB", cursor: "pointer", fontSize: 16, padding: "0 4px" }}
                      onMouseEnter={e => e.target.style.color="#EF4444"} onMouseLeave={e => e.target.style.color="#D1D5DB"}>✕</button>
                  </div>
                );
              })}
            </div>
            <div style={{ padding: "14px 20px", borderTop: "1px solid #F3F4F6", display: "flex", gap: 10 }}>
              <button onClick={handleConfirm} disabled={staging.length === 0 || saving}
                style={{ flex: 1, background: staging.length > 0 && !saving ? "linear-gradient(135deg,#7C3AED,#3B82F6)" : "#F3F4F6", color: staging.length > 0 && !saving ? "#fff" : "#9CA3AF", border: "none", borderRadius: 10, padding: "13px", fontSize: 15, fontWeight: 700, cursor: staging.length > 0 ? "pointer" : "not-allowed", fontFamily: "'Sarabun', sans-serif" }}>
                {saving ? "⏳ กำลังบันทึก..." : `✅ ยืนยัน ${staging.length} รายการ`}
              </button>
              <button onClick={handleCancel} style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", color: "#6B7280", borderRadius: 10, padding: "13px 18px", fontSize: 14, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// RETURN MYORDER PANEL — ตีกลับ myorder
// แท็บที่ 4 ใน ReturnCheckerTab
// Upload Excel export จาก myorder (เก็บ 8 คอลัมน์: B,C,D,E,F,J,L,P)
// + join เลขขากลับจาก return_flash_items + สถานะยิงรับเข้าคลังจาก return_scans
// + ขีดฆ่า/ทำสีจางแถวที่ครบทั้ง 2 ช่อง
// ============================================================

// แยกเลข tracking ออกจากขนส่งในวงเล็บ เช่น "TH03048VMGFM6B (FLASH)" -> { tracking: "TH03048VMGFM6B", courier: "FLASH" }
const parseMyorderTrackingCell = (raw) => {
  if (!raw) return { tracking: "", courier: "" };
  const s = String(raw).trim();
  const m = s.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m) return { tracking: m[1].trim(), courier: m[2].trim() };
  return { tracking: s, courier: "" };
};

// แปลงค่า "วันที่สั่งซื้อ" (ข้อความอิสระจากไฟล์ myorder) ให้เป็น "YYYY-MM-DD" สำหรับใช้กรองช่วงเวลา
// รองรับ yyyy-mm-dd, dd/mm/yyyy (รวม พ.ศ.) — ถ้าแปลงไม่ได้คืนค่า null
const parseThaiOrderDate = (raw) => {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    let [, y, mo, d] = m;
    y = Number(y); if (y > 2400) y -= 543;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) {
    let [, d, mo, y] = m;
    y = Number(y); if (y > 2400) y -= 543;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
};

async function loadXLSXForMyorder() { return loadXLSX(); }

function ReturnMyorderPanel({ focusOrderNo, onFocusHandled }) {
  const dateFilter = useDateFilterState("all"); // ตัวกรองวันที่ — อิงวันที่สั่งซื้อ (order_date), fallback เป็นวันที่นำเข้าถ้าแปลงวันที่สั่งซื้อไม่ได้
  const [items, setItems] = useState([]); // จาก return_myorder_items
  const [flashItems, setFlashItems] = useState([]); // จาก return_flash_items (ทั้งหมด — ใช้ join)
  const [scans, setScans] = useState([]); // จาก return_scans (ทั้งหมด — ใช้ join)
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");
  const [importMsg, setImportMsg] = useState(null);
  const fileInputRef = useRef(null);
  const rowRefs = useRef({});

  const loadAllData = async () => {
    setLoading(true);
    try {
      const [myorderRows, flashRows, scanRows] = await Promise.all([
        sbReturnAll("return_myorder_items", "select=*&order=imported_at.desc"),
        sbReturnAll("return_flash_items", "select=outbound_tracking,return_tracking,flash_time"),
        sbReturnAll("return_scans", "select=tracking_code,scanned_at,scanned_by"),
      ]);
      setItems(myorderRows || []);
      setFlashItems(flashRows || []);
      setScans(scanRows || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { loadAllData(); }, []);

  // map: outbound_tracking -> { return_tracking, flash_time }
  const flashMap = useMemo(() => {
    const m = {};
    flashItems.forEach(f => { if (f.outbound_tracking && !m[f.outbound_tracking]) m[f.outbound_tracking] = f; });
    return m;
  }, [flashItems]);

  // map: tracking_code (ที่ยิงรับเข้าคลัง) -> scan record
  const scanMap = useMemo(() => {
    const m = {};
    scans.forEach(s => { if (s.tracking_code && !m[s.tracking_code]) m[s.tracking_code] = s; });
    return m;
  }, [scans]);

  // รวมข้อมูลแต่ละแถว + คำนวณสถานะ
  // กรณีพิเศษ: เลขขึ้นต้นด้วย WA (ไปรษณีย์ไทย) — เลขขาไปและเลขขากลับเป็นเลขเดียวกัน
  // จึงไม่ต้องรอ Flash แจ้งเลขขากลับ ให้เทียบ outbound_tracking กับ return_scans ตรงๆ
  const rows = useMemo(() => {
    return items.map(it => {
      const normDate = parseThaiOrderDate(it.order_date) || (it.imported_at ? it.imported_at.slice(0, 10) : null);
      const isWA = /^WA/i.test(it.outbound_tracking || "");
      if (isWA) {
        const scan = scanMap[it.outbound_tracking];
        return {
          ...it,
          normDate,
          returnTracking: it.outbound_tracking, // เลขเดียวกัน
          flashTime: "",
          isThaiPost: true,
          scanned: !!scan,
          scannedAt: scan?.scanned_at || null,
          scannedBy: scan?.scanned_by || null,
          isComplete: !!scan, // ไปรษณีย์ไทย: ยิงรับเข้าคลังแล้วก็ถือว่าเสร็จ ไม่ต้องรอ Flash
        };
      }
      const flash = flashMap[it.outbound_tracking];
      const returnTracking = flash?.return_tracking || null;
      const scan = returnTracking ? scanMap[returnTracking] : null;
      return {
        ...it,
        normDate,
        returnTracking,
        flashTime: flash?.flash_time || "",
        isThaiPost: false,
        scanned: !!scan,
        scannedAt: scan?.scanned_at || null,
        scannedBy: scan?.scanned_by || null,
        isComplete: !!returnTracking && !!scan, // ครบทั้ง 2 ช่อง -> ขีดฆ่า/จาง
      };
    });
  }, [items, flashMap, scanMap]);

  // กรองตามช่วงเวลาที่เลือก (อิงวันที่สั่งซื้อ) — "ทั้งหมด" ไม่กรอง
  const dateFilteredRows = useMemo(() => {
    if (dateFilter.mode === "all") return rows;
    const from = dateFilter.rangeFrom, to = dateFilter.rangeTo;
    return rows.filter(r => {
      if (!r.normDate) return false;
      if (from && r.normDate < from) return false;
      if (to && r.normDate > to) return false;
      return true;
    });
  }, [rows, dateFilter.mode, dateFilter.rangeFrom, dateFilter.rangeTo]);

  const filteredRows = useMemo(() => {
    if (!search.trim()) return dateFilteredRows;
    const q = search.trim().toLowerCase();
    return dateFilteredRows.filter(r =>
      (r.order_no || "").toLowerCase().includes(q) ||
      (r.customer_name || "").toLowerCase().includes(q) ||
      (r.outbound_tracking || "").toLowerCase().includes(q) ||
      (r.returnTracking || "").toLowerCase().includes(q) ||
      (r.product || "").toLowerCase().includes(q)
    );
  }, [dateFilteredRows, search]);

  // เลื่อนไปยังแถวที่ระบุ เมื่อมีการคลิกลิงก์มาจากหน้าสรุป
  useEffect(() => {
    if (!focusOrderNo) return;
    setSearch(focusOrderNo);
    const tryScroll = () => {
      const el = rowRefs.current[focusOrderNo];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.outline = "2px solid #7C3AED";
        setTimeout(() => { if (el) el.style.outline = "none"; }, 2000);
      }
    };
    setTimeout(tryScroll, 250);
    if (onFocusHandled) onFocusHandled();
  }, [focusOrderNo]);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const XLSX = await loadXLSXForMyorder();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      // อ่านเป็น array-of-array เพื่ออ้างคอลัมน์ตามตำแหน่ง B,C,D,E,F,J,L,P (index 1,2,3,4,5,9,11,15) ไม่พึ่งชื่อ header
      const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      const dataRows = aoa.slice(1); // แถวแรกเป็น header

      const parsedRows = dataRows
        .filter(r => r && r[1] !== undefined && String(r[1]).trim() !== "")
        .map(r => {
          const orderNo = String(r[1]).trim();
          const { tracking, courier } = parseMyorderTrackingCell(r[11]);
          return {
            order_no: orderNo,
            channel: r[2] != null ? String(r[2]).trim() : "",
            order_date: r[3] != null ? String(r[3]).trim() : "",
            customer_name: r[4] != null ? String(r[4]).trim() : "",
            phone: r[5] != null ? String(r[5]).trim() : "",
            product: r[9] != null ? String(r[9]).trim() : "",
            outbound_tracking: tracking,
            courier: courier,
            amount: r[15] !== "" && r[15] != null ? Number(String(r[15]).replace(/,/g, "")) || 0 : 0,
          };
        });

      if (parsedRows.length === 0) {
        setImportMsg({ type: "error", text: "ไม่พบข้อมูลในไฟล์ที่อัปโหลด — ตรวจสอบว่าเป็นไฟล์ export จาก myorder" });
        setImporting(false);
        return;
      }

      // กันซ้ำ: เทียบ order_no กับที่มีอยู่แล้วในระบบ
      const existingOrderNos = new Set(items.map(it => it.order_no));
      const newRows = parsedRows.filter(r => !existingOrderNos.has(r.order_no));
      const skippedCount = parsedRows.length - newRows.length;

      if (newRows.length > 0) {
        // insert เป็น batch กันคำขอใหญ่เกินไป
        const chunkSize = 200;
        for (let i = 0; i < newRows.length; i += chunkSize) {
          const chunk = newRows.slice(i, i + chunkSize);
          await sbReturn("return_myorder_items", { method: "POST", body: JSON.stringify(chunk) });
        }
      }

      setImportMsg({
        type: "success",
        text: `นำเข้าสำเร็จ: เพิ่มใหม่ ${newRows.length} รายการ${skippedCount > 0 ? `, ข้ามรายการที่ซ้ำ ${skippedCount} รายการ` : ""}`,
      });
      await loadAllData();
    } catch (err) {
      setImportMsg({ type: "error", text: "นำเข้าไม่สำเร็จ: " + (err.message || String(err)) });
    }
    setImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 4 }}>📋 ตีกลับ myorder</h2>
          <p style={{ fontSize: 13, color: "#6B7280" }}>อัปโหลดไฟล์ export จาก myorder — ระบบจะกรองรายการที่ไม่ซ้ำให้อัตโนมัติ</p>
        </div>
        <div>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleFileChange} />
          <button onClick={() => fileInputRef.current?.click()} disabled={importing}
            style={{ background: importing ? "#F3F4F6" : "linear-gradient(135deg,#7C3AED,#3B82F6)", color: importing ? "#9CA3AF" : "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: importing ? "not-allowed" : "pointer", fontFamily: "'Sarabun', sans-serif" }}>
            {importing ? "⏳ กำลังนำเข้า..." : "📤 อัปโหลดไฟล์ Excel"}
          </button>
        </div>
      </div>

      {/* ตัวกรองวันที่ — อิงวันที่สั่งซื้อ */}
      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#7C3AED", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>📅 ช่วงเวลา (อิงวันที่สั่งซื้อ)</div>
        <DateFilterRow filter={dateFilter} accent="linear-gradient(135deg,#7C3AED,#3B82F6)" />
      </div>

      {/* สรุปยอด — ตามช่วงเวลาที่เลือก */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 16 }}>
        {[
          { label: "ทั้งหมด", value: dateFilteredRows.length, color: "#6B7280", bg: "#F9FAFB" },
          { label: "✅ เสร็จแล้ว", value: dateFilteredRows.filter(r => r.scanned).length, color: "#065F46", bg: "#D1FAE5" },
          { label: "⏳ รอดำเนินการ", value: dateFilteredRows.filter(r => !r.scanned).length, color: "#92400E", bg: "#FEF3C7" },
        ].map((s, i) => (
          <div key={i} style={{ background: s.bg, borderRadius: 12, padding: "12px 14px", textAlign: "center", border: "1px solid #E5E7EB" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#6B7280", marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {importMsg && (
        <div style={{ background: importMsg.type === "success" ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${importMsg.type === "success" ? "#BBF7D0" : "#FECACA"}`, color: importMsg.type === "success" ? "#065F46" : "#991B1B", borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 13 }}>
          {importMsg.type === "success" ? "✅ " : "⚠️ "}{importMsg.text}
        </div>
      )}

      <input className="inp" style={{ marginBottom: 16 }} placeholder="🔍 ค้นหา Order No. / ชื่อลูกค้า / เลข tracking / สินค้า..."
        value={search} onChange={e => setSearch(e.target.value)} />

      {loading && <div style={{ textAlign: "center", padding: 40, color: "#6B7280" }}>กำลังโหลดข้อมูล...</div>}

      {!loading && (
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, overflow: "hidden", overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Order No.</th>
                <th>ช่องทาง/เพจ</th>
                <th>วันที่สั่งซื้อ</th>
                <th>ชื่อลูกค้า</th>
                <th>เบอร์โทร</th>
                <th>สินค้า</th>
                <th>เลขขาไป</th>
                <th>ยอดเงิน (฿)</th>
                <th>เลขขากลับ (Flash)</th>
                <th>ยิงรับเข้าคลัง</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.id} ref={el => { if (el) rowRefs.current[r.order_no] = el; }}
                  style={{
                    opacity: r.isComplete ? 0.45 : 1,
                    textDecoration: r.isComplete ? "line-through" : "none",
                    transition: "outline 0.2s",
                  }}>
                  <td style={{ fontFamily: "monospace", fontSize: 12, whiteSpace: "nowrap" }}>{r.order_no}</td>
                  <td style={{ fontSize: 13, maxWidth: 160 }}>{r.channel}</td>
                  <td style={{ fontSize: 12, color: "#6B7280", whiteSpace: "nowrap" }}>{r.order_date}</td>
                  <td style={{ fontSize: 13 }}>{r.customer_name}</td>
                  <td style={{ fontSize: 12, color: "#6B7280", whiteSpace: "nowrap" }}>{r.phone}</td>
                  <td style={{ fontSize: 12, maxWidth: 200 }}>{r.product}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 11, color: "#374151" }}>{r.outbound_tracking}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{Number(r.amount || 0).toLocaleString("th-TH")}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 11 }}>
                    {r.isThaiPost
                      ? <span style={{ color: "#0EA5E9" }}>📮 ไปรษณีย์ไทย (เลขเดียวกัน)</span>
                      : r.returnTracking
                        ? <span style={{ color: "#7C3AED" }}>{r.returnTracking}{r.flashTime ? ` (${r.flashTime})` : ""}</span>
                        : <span style={{ color: "#9CA3AF" }}>ยังไม่มีจาก Flash</span>}
                  </td>
                  <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                    {r.scanned
                      ? <span style={{ color: "#065F46", fontWeight: 600 }}>✅ ยิงแล้ว {fmtDateTime(r.scannedAt)}</span>
                      : <span style={{ color: "#991B1B" }}>❌ ยังไม่ยิง</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredRows.length === 0 && (
            <div style={{ textAlign: "center", padding: 48, color: "#9CA3AF" }}>
              {items.length === 0
                ? "ยังไม่มีข้อมูล — กดอัปโหลดไฟล์ Excel จาก myorder ด้านบน"
                : dateFilteredRows.length === 0
                  ? "ไม่มีรายการในช่วงเวลาที่เลือก"
                  : "ไม่พบรายการที่ค้นหา"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReturnCheckerTab() {
  const [subTab, setSubTab] = useState(() => localStorage.getItem("returnSubTab") || "summary");
  const [myorderFocusOrder, setMyorderFocusOrder] = useState(null); // order_no ที่จะ scroll/highlight ไปหา เมื่อกดลิงก์จากหน้าสรุป
  const setAndSave = (v) => { setSubTab(v); localStorage.setItem("returnSubTab", v); };
  const goToMyorder = (orderNo) => {
    setMyorderFocusOrder(orderNo);
    setAndSave("myorder");
  };
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 28, flexWrap: "wrap" }}>
        {[["summary","📊 สรุปรวม"],["admin","🗂 ตีกลับในระบบ"],["staff","📦 ตีกลับถึงคลัง"],["myorder","📋 ตีกลับ myorder"]].map(([v,l]) => (
          <button key={v} onClick={() => setAndSave(v)}
            style={{ background: subTab === v ? "linear-gradient(135deg,#7C3AED,#3B82F6)" : "#fff", color: subTab === v ? "#fff" : "#6B7280", border: subTab === v ? "none" : "1px solid #E5E7EB", borderRadius: 10, padding: "9px 20px", fontSize: 14, fontWeight: subTab === v ? 700 : 400, cursor: "pointer", fontFamily: "'Sarabun', sans-serif", transition: "all 0.2s", boxShadow: subTab === v ? "0 4px 12px rgba(124,58,237,0.3)" : "none" }}>
            {l}
          </button>
        ))}
      </div>
      {subTab === "summary" ? <ReturnSummaryPanel onGoToMyorder={goToMyorder} />
        : subTab === "admin" ? <ReturnAdminPanel />
        : subTab === "staff" ? <ReturnStaffPanel />
        : <ReturnMyorderPanel focusOrderNo={myorderFocusOrder} onFocusHandled={() => setMyorderFocusOrder(null)} />}
    </div>
  );
}

// ============================================================
// ═══════════ ยิงตัดสต๊อกจากใบหยิบ (สลิป MyOrder extension v3.8 → order_scans) ═══════════
// flow: extension พิมพ์สลิปพร้อมบาร์โค้ด "PK<id ของแถว order_scans>" → ฝ่ายคลังยิง PK เปิดใบใน StockMaster (เปิดปุ๊บสถานะเป็น "รอตัดสต็อก" สีเหลืองทันที)
// → จับคู่ "ชื่อสินค้าตาม myorder" (รวมชื่อโปร เช่น "6 แพค ฟรี 1 แพค") เป็น SKU × จำนวนชิ้น (ตาราง product_aliases จำไว้ตลอด)
// → รายการถูกรวมเป็นราย SKU → ยิงบาร์โค้ด SKU ทีละชิ้น หรือยิงครั้งแรกแล้วกด "ครบ ✓" ยืนยันยอดรวมทั้งไลน์ — ขั้นตอนนี้ "ไม่" ตัดสต็อกจริง แค่บันทึกความคืบหน้า
// → ตัดสต็อกจริงทีเดียวตอนกด "ยืนยันปิดใบหยิบ" เท่านั้น (กันตัดสต็อกไปก่อนโดยยังไม่ได้ยืนยันปิดบิล) — ปิดใบแล้วลบไม่ได้ ต้องยกเลิกก่อนปิดถ้าเปิดผิดใบ
// ต้องรัน scan-verify-setup.sql ใน Supabase ก่อนใช้ครั้งแรก (เพิ่มคอลัมน์ pick_* ใน order_scans + ตาราง product_aliases)

// Code128 ชุด B วาดเป็น SVG เอง — ใช้แผ่นบาร์โค้ด SKU (ตารางเดียวกับที่ใช้ใน extension พิมพ์รหัส PK)
const C128 = ["212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112"];
const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function code128Svg(text, { height = 44, module = 2, fontSize = 12 } = {}) {
  const vals = [104]; // Start B
  for (const ch of String(text)) { const c = ch.charCodeAt(0); if (c < 32 || c > 126) return ""; vals.push(c - 32); }
  let sum = 104; for (let i = 1; i < vals.length; i++) sum += vals[i] * i;
  vals.push(sum % 103, 106); // checksum + Stop
  let x = 10 * module, rects = "";
  for (const v of vals) { const pat = C128[v]; for (let i = 0; i < pat.length; i++) { const w = Number(pat[i]) * module; if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="${height}"/>`; x += w; } }
  const totalW = x + 10 * module, textH = fontSize + 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${height + textH}" width="${totalW}" height="${height + textH}" shape-rendering="crispEdges"><g fill="#000">${rects}</g><text x="${totalW / 2}" y="${height + fontSize}" text-anchor="middle" font-family="monospace" font-size="${fontSize}" fill="#000">${escHtml(text)}</text></svg>`;
}

const pickName = (s) => String(s || "").replace(/\s+/g, " ").trim();

// พิมพ์ HTML ผ่าน iframe ที่ซ่อนอยู่ในหน้าเดิม แทน window.open("", "_blank")
// เพราะ window.open มักถูกเบราว์เซอร์บล็อกแบบเงียบๆ (คืนค่า null โดยไม่มี error/แจ้งเตือนใดๆ)
// ทำให้กดพิมพ์แล้วไม่มีอะไรเกิดขึ้นเลย — iframe ในหน้าเดิมไม่ต้องขอสิทธิ์ popup จึงพิมพ์ได้เสมอ
function printHtmlInPlace(html) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(iframe);
  const remove = () => { try { document.body.removeChild(iframe); } catch {} };
  iframe.onload = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.onafterprint = remove;
      iframe.contentWindow.print();
    } catch (e) { remove(); return; }
    setTimeout(remove, 20000); // กันไว้เผื่อ afterprint ไม่ยิงในบางเบราว์เซอร์
  };
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
}
const PICK_SETUP_HINT = "ยังไม่ได้ตั้งค่าฐานข้อมูล — รันไฟล์ scan-verify-setup.sql ใน Supabase SQL Editor ก่อน (เพิ่มคอลัมน์ pick_* ใน order_scans และตาราง product_aliases)";
// order_scans ถูกใช้เก็บยอดสรุปที่ extension ส่งเข้ามาทุกครั้งที่พิมพ์สลิปมาตั้งแต่ก่อนฟีเจอร์ "ยิงตัดสต็อก" นี้จะมีอยู่ (ใช้เทียบยอดในหน้าเช็คออเดอร์ > สรุปรายวัน)
// รายการเก่าก่อนวันนี้ที่ไม่เคยถูกยิงเปิดเลย (pick_status ว่าง) จึงเป็นแค่ log เก่า ไม่ใช่ใบหยิบจริง — ซ่อนไว้ไม่ให้มากองในหน้านี้ แต่ไม่ลบข้อมูลจริงออกจากฐานข้อมูล
const PICK_FEATURE_FLOOR = "2026-09-13T00:00:00+07:00";
const isSetupError = (e) => /pick_|product_aliases|schema cache|PGRST20/i.test(String(e?.message || e));

// แปลงแถว product_aliases → Map(ชื่อ myorder → components [{product_id, qty}])  ([] = ไม่มีในคลัง ไม่ตัดสต็อก)
const aliasRowsToMap = (rows) => {
  const m = new Map();
  (rows || []).forEach(r => {
    const comps = Array.isArray(r.components) ? r.components.map(c => ({ product_id: Number(c.product_id), qty: Math.max(1, Number(c.qty) || 1) })).filter(c => Number.isFinite(c.product_id)) : [];
    m.set(pickName(r.myorder_name), comps);
  });
  return m;
};

// เดาจำนวนชิ้นต่อ 1 หน่วยที่ขาย จากชื่อโปรของ myorder — เป็นแค่ค่าเริ่มต้นในฟอร์ม ต้องกดบันทึกยืนยันเสมอ
//   "แปรงหินภูเขาไฟ RingX(6 แพค ฟรี 1 แพค)" → 7 · "จารบี 1 แถม 1 ( 2 กระปุก )" → 2 · "(โปร 3 กล่อง)" → 3 · "(2 แพค)" → 2
const UNIT_WORDS = "แพค|แพ็ค|แพ็ก|กล่อง|ชิ้น|กระปุก|ขวด|ซอง|คู่|อัน|ห่อ|ชุด|แผ่น|แท่ง|ม้วน|ใบ|ตัว|ถุง|หลอด|ก้อน|ด้าม";
const guessMultiplier = (name) => {
  const s = pickName(name);
  let m = s.match(/(\d+)\s*(?:[^\d()]{0,12}?)\s*(?:ฟรี|แถม)\s*(\d+)/);
  if (m) return Number(m[1]) + Number(m[2]);
  m = s.match(new RegExp(`\\(\\s*(?:โปร\\s*)?(\\d+)\\s*(?:${UNIT_WORDS})\\s*\\)`));
  if (m) return Number(m[1]);
  m = s.match(new RegExp(`(?:โปร|เซ็ต|ชุด)\\s*(\\d+)\\s*(?:${UNIT_WORDS})`));
  if (m) return Number(m[1]);
  return 1;
};
// ตัดส่วนโปร/วงเล็บออก เพื่อเดาว่าคือสินค้าตัวไหนในคลัง — เดาเฉพาะตอนได้คำตอบเดียวชัดๆ
const stripPromo = (name) => pickName(String(name || "").replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ").replace(/\d+\s*(?:ฟรี|แถม)\s*\d+/g, " "));
const guessProduct = (name, products) => {
  const full = pickName(name).toLowerCase();
  const exactFull = products.find(p => pickName(p.name).toLowerCase() === full);
  if (exactFull) return exactFull;
  const base = stripPromo(name).toLowerCase();
  if (!base) return null;
  const exact = products.find(p => pickName(p.name).toLowerCase() === base);
  if (exact) return exact;
  const cands = products.filter(p => { const pn = pickName(p.name).toLowerCase(); return pn.length >= 3 && (base.includes(pn) || pn.includes(base)); });
  return cands.length === 1 ? cands[0] : null;
};

// เสียงตอบรับ: ok = ติ๊งสั้น, warn = กลาง, bad = ต่ำสองครั้ง (ให้แยกได้ด้วยหูโดยไม่ต้องมองจอ)
const playScanTone = (kind) => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const tone = (freq, start, dur) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination); o.type = "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(0.3, ctx.currentTime + start); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      o.start(ctx.currentTime + start); o.stop(ctx.currentTime + start + dur);
    };
    if (kind === "ok") tone(880, 0, 0.18);
    else if (kind === "warn") tone(520, 0, 0.3);
    else { tone(260, 0, 0.25); tone(260, 0.3, 0.35); }
  } catch {}
};

const pickStatusLabel = (s) => s === "closed" ? "ตัดสต็อกแล้ว" : s === "picking" ? "รอตัดสต็อก" : "ยังไม่เริ่ม";
const fmtDT = (iso) => iso ? new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-";
// ตัวกรองวันที่แบบด่วนของรายการใบหยิบ — "all" ไม่ส่งเงื่อนไขวันที่เลย ที่เหลือคืน [from, to] เป็น YYYY-MM-DD
const pickDateRangeForPreset = (preset, customFrom, customTo) => {
  const now = new Date();
  if (preset === "today") { const d = localDateStr(now); return [d, d]; }
  if (preset === "yesterday") { const y = new Date(now); y.setDate(y.getDate() - 1); const d = localDateStr(y); return [d, d]; }
  if (preset === "month") { const from = new Date(now.getFullYear(), now.getMonth(), 1); return [localDateStr(from), localDateStr(now)]; }
  return [customFrom, customTo]; // "custom"
};
const btnStyle = (bg, fg, extra = {}) => ({ background: bg, color: fg, border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", ...extra });

// ── ฟอร์มจับคู่ "ชื่อ myorder" → SKU × จำนวน (หลายบรรทัดได้สำหรับเซ็ตที่มีหลาย SKU) ──
function AliasEditor({ name, products, initial, onSave, onCancel, onAddProduct }) {
  const [rows, setRows] = useState(() => {
    if (Array.isArray(initial) && initial.length) return initial.map(c => ({ pid: String(c.product_id), qty: c.qty }));
    const g = guessProduct(name, products);
    return [{ pid: g ? String(g.id) : "auto", qty: guessMultiplier(name) }];
  });
  const [saving, setSaving] = useState(false);
  const guessed = useMemo(() => guessProduct(name, products), [name, products]);
  const valid = rows.filter(r => r.pid !== "auto" && r.pid !== "none" && Number(r.qty) >= 1);
  const setRow = (i, patch) => setRows(prev => prev.map((r, j) => j === i ? { ...r, ...patch } : r));
  const save = async (comps) => { setSaving(true); try { await onSave(comps); } finally { setSaving(false); } };
  return (
    <div style={{ marginTop: 8, background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 12, padding: "10px 12px" }} data-nofocus>
      <div style={{ fontSize: 12, color: "#92400E", fontWeight: 700, marginBottom: 6 }}>
        "{name}" ขาย 1 หน่วย = ต้องหยิบสินค้าอะไร กี่ชิ้น?
        {guessed && rows.length === 1 && rows[0].pid === String(guessed.id) && <span style={{ color: "#B45309", fontWeight: 400 }}> (ระบบเดาให้ — เช็คให้ตรงก่อนบันทึก)</span>}
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
          <ProductPicker products={products} value={r.pid} autoLabel="— เลือกสินค้าในคลัง —" onPick={v => setRow(i, { pid: v })} />
          <span style={{ fontSize: 13, color: "#374151" }}>×</span>
          <input className="inp" type="number" min={1} max={999} value={r.qty} onChange={e => setRow(i, { qty: Math.max(1, parseInt(e.target.value) || 1) })} style={{ width: 70, padding: "6px 8px", fontSize: 13, textAlign: "center" }} />
          <span style={{ fontSize: 12, color: "#6B7280" }}>ชิ้น</span>
          {rows.length > 1 && <button onClick={() => setRows(prev => prev.filter((_, j) => j !== i))} style={btnStyle("none", "#9CA3AF", { padding: "4px 6px" })}>✕</button>}
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => setRows(prev => [...prev, { pid: "auto", qty: 1 }])} style={btnStyle("#fff", "#7C3AED", { border: "1px solid #DDD6FE" })}>＋ เพิ่ม SKU อีกตัว (เซ็ต)</button>
        <button onClick={() => onAddProduct(name)} style={btnStyle("#EDE9FE", "#7C3AED")}>สินค้ายังไม่มีในคลัง → เพิ่มสินค้าใหม่</button>
        <button onClick={() => save([])} disabled={saving} style={btnStyle("#F3F4F6", "#6B7280")}>ไม่ตัดสต็อกตัวนี้</button>
        <div style={{ flex: 1 }} />
        <button onClick={onCancel} style={btnStyle("none", "#6B7280")}>ยกเลิก</button>
        <button onClick={() => save(valid.map(r => ({ product_id: Number(r.pid), qty: Number(r.qty) })))} disabled={saving || valid.length === 0}
          style={btnStyle(valid.length ? "#7C3AED" : "#E5E7EB", "#fff", { padding: "7px 14px", cursor: valid.length ? "pointer" : "not-allowed" })}>{saving ? "⏳" : "💾 บันทึกการจับคู่"}</button>
      </div>
    </div>
  );
}

function PickScanPanel({ products, aliases, onAliasesChange, showToast, onStockCut, onAddProduct }) {
  const [staffName, setStaffName] = useState(() => { try { return localStorage.getItem("staffName") || ""; } catch { return ""; } });
  const [pick, setPick] = useState(null);           // แถว order_scans ที่กำลังหยิบ
  const [progress, setProgress] = useState({});      // { [product_id]: { scanned, short } }
  const [setupError, setSetupError] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [loadingPick, setLoadingPick] = useState(false);
  const [scanInput, setScanInput] = useState("");
  const [last, setLast] = useState(null);            // { status: ok|warn|bad|info, msg, product, line }
  const [showSummary, setShowSummary] = useState(false);
  const [closing, setClosing] = useState(false);
  const [editingName, setEditingName] = useState(null);
  const [bulkFor, setBulkFor] = useState(null);      // { pid } กำลังยืนยันปุ่ม "ครบ ✓"
  const [busy, setBusy] = useState(false);
  const [recentPreset, setRecentPreset] = useState("all"); // "all" | "today" | "yesterday" | "month" | "custom"
  const [recentFrom, setRecentFrom] = useState(() => localDateStr(new Date()));
  const [recentTo, setRecentTo] = useState(() => localDateStr(new Date()));
  const [recentStatusFilter, setRecentStatusFilter] = useState("pending"); // "all" | "pending" | "closed"
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 900); // จอแคบ (มือถือ/แท็บเล็ต) → คอลัมน์เดียว รูปอยู่บน
  useEffect(() => { const onResize = () => setNarrow(window.innerWidth < 900); window.addEventListener("resize", onResize); return () => window.removeEventListener("resize", onResize); }, []);
  const inputRef = useRef(null);
  const queueRef = useRef(Promise.resolve());
  const pickRef = useRef(null);
  const progressRef = useRef({});
  const staffRef = useRef(staffName); staffRef.current = staffName;
  const localQty = useRef({});      // จำนวนคงเหลือหลังตัดในรอบนี้ (กัน props ยังไม่ทัน re-render ตอนยิงรัวๆ)
  const summaryShownRef = useRef(false);
  const setupToastRef = useRef(false);

  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const productBySku = useMemo(() => { const m = new Map(); products.forEach(p => { if (p.sku) m.set(String(p.sku).trim().toUpperCase(), p); }); return m; }, [products]);
  const productByName = useMemo(() => { const m = new Map(); products.forEach(p => m.set(pickName(p.name), p)); return m; }, [products]);

  // 1) รายการตามชื่อ myorder → components  2) รวมเป็นราย SKU (line) = สิ่งที่พนักงานต้องหยิบจริง
  const { items, lines, unmapped } = useMemo(() => {
    const list = Array.isArray(pick?.products) ? pick.products : [];
    const lineMap = new Map();
    const items = list.map(raw => {
      const name = pickName(raw.name); const orderQty = Number(raw.qty) || 0;
      let comps = aliases.has(name) ? aliases.get(name) : undefined;
      let auto = false;
      if (comps === undefined) { const p = productByName.get(name); if (p) { comps = [{ product_id: p.id, qty: 1 }]; auto = true; } }
      const missing = Array.isArray(comps) && comps.some(c => !productById.has(c.product_id));
      const it = { name, orderQty, comps, auto, skip: Array.isArray(comps) && comps.length === 0, unmapped: comps === undefined || missing, missing };
      if (Array.isArray(comps) && !missing) comps.forEach(c => {
        const key = String(c.product_id);
        const line = lineMap.get(key) || { pid: c.product_id, product: productById.get(c.product_id), required: 0, sources: [] };
        line.required += orderQty * c.qty;
        line.sources.push({ name, orderQty, per: c.qty });
        lineMap.set(key, line);
      });
      return it;
    });
    const lines = [...lineMap.values()].map(l => { const pr = progress[String(l.pid)] || {}; return { ...l, scanned: Number(pr.scanned) || 0, short: Number(pr.short) || 0 }; })
      .sort((a, b) => a.product.name.localeCompare(b.product.name, "th"));
    return { items, lines, unmapped: items.filter(it => it.unmapped) };
  }, [pick, progress, aliases, productById, productByName]);
  const linesRef = useRef(lines); linesRef.current = lines;
  const allDone = lines.length > 0 && unmapped.length === 0 && lines.every(l => l.scanned + l.short >= l.required);
  const isClosed = pick?.pick_status === "closed";
  const totalScanned = lines.reduce((s, l) => s + l.scanned, 0);
  const totalRequired = lines.reduce((s, l) => s + l.required, 0);

  const handleSetupError = (e) => {
    if (isSetupError(e)) { setSetupError(PICK_SETUP_HINT); if (!setupToastRef.current) { setupToastRef.current = true; showToast(PICK_SETUP_HINT, "error"); } return true; }
    return false;
  };

  const loadRecent = async () => {
    setLoadingRecent(true);
    try {
      let rows;
      if (recentPreset === "all") {
        rows = await api.getOrderScans();
      } else {
        const [from, to] = pickDateRangeForPreset(recentPreset, recentFrom, recentTo);
        const fromIso = new Date(from + "T00:00:00").toISOString();
        const toIso = new Date(to + "T23:59:59").toISOString();
        rows = await api.getOrderScansRange(fromIso, toIso);
      }
      const notStaleLog = (rows || []).filter(r => r.pick_status || new Date(r.created_at) >= new Date(PICK_FEATURE_FLOOR));
      const filtered = recentStatusFilter === "all" ? notStaleLog
        : recentStatusFilter === "closed" ? notStaleLog.filter(r => r.pick_status === "closed")
        : notStaleLog.filter(r => r.pick_status !== "closed");
      setRecent(filtered);
    } catch (e) { showToast(e.message, "error"); }
    setLoadingRecent(false);
  };
  useEffect(() => { loadRecent(); }, [recentPreset, recentFrom, recentTo, recentStatusFilter]);

  // โฟกัสช่องยิงค้างไว้เสมอ — ยกเว้นตอนผู้ใช้กำลังพิมพ์ในช่องอื่น หรืออยู่ในฟอร์มจับคู่ (data-nofocus)
  useEffect(() => {
    const focus = () => { const el = inputRef.current; if (el && document.activeElement !== el) el.focus(); };
    focus();
    const onClick = (e) => { const t = e.target; if (!t || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return; if (t.closest && t.closest("[data-nofocus]")) return; setTimeout(focus, 60); };
    const onKey = () => { const a = document.activeElement; if (!a || a === document.body) focus(); };
    document.addEventListener("click", onClick); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onClick); document.removeEventListener("keydown", onKey); };
  }, []);

  const setStaff = (v) => { setStaffName(v); try { localStorage.setItem("staffName", v); } catch {} };

  const applyPick = (row) => {
    pickRef.current = row; setPick(row);
    const prog = row?.pick_progress && typeof row.pick_progress === "object" ? row.pick_progress : {};
    progressRef.current = prog; setProgress(prog);
    localQty.current = {}; summaryShownRef.current = false; setShowSummary(false); setEditingName(null); setBulkFor(null);
  };

  const loadPick = async (id) => {
    setLoadingPick(true);
    try {
      const rows = await api.getOrderScan(id);
      let row = rows && rows[0];
      if (!row) { playScanTone("bad"); setLast({ status: "bad", msg: `ไม่พบใบหยิบ PK${id} ในระบบ` }); setLoadingPick(false); return; }
      // เปิดใบปุ๊บมาร์คสถานะ "รอตัดสต็อก" (เหลือง) ทันที แม้ยังไม่ได้ยิง SKU ไหนเลย — ให้เห็นว่ามีใบนี้ค้างอยู่
      if (row.pick_status !== "closed" && row.pick_status !== "picking") {
        try { await api.updateOrderScan(row.id, { pick_status: "picking", picked_by: staffRef.current || row.picked_by || null }); row = { ...row, pick_status: "picking" }; }
        catch (e) { handleSetupError(e); }
      }
      applyPick(row);
      const n = Array.isArray(row.products) ? row.products.length : 0;
      if (row.pick_status === "closed") { playScanTone("warn"); setLast({ status: "warn", msg: `ใบหยิบ PK${id} ตัดสต็อกไปแล้ว (${fmtDT(row.pick_closed_at)}) — ดูได้อย่างเดียว` }); }
      else { playScanTone("ok"); setLast({ status: "info", msg: `เปิดใบหยิบ PK${id} · ${row.page_name || "ไม่ระบุเพจ"} · ${n} รายการ ${row.total_items || 0} หน่วยขาย · รอตัดสต็อกตอนปิดใบ` }); }
    } catch (e) { playScanTone("bad"); setLast({ status: "bad", msg: e.message }); }
    setLoadingPick(false);
  };

  const saveProgress = async (next, extra = {}) => {
    progressRef.current = next; setProgress(next);
    const p = pickRef.current; if (!p) return;
    try {
      await api.updateOrderScan(p.id, { pick_progress: next, pick_status: extra.pick_status || (p.pick_status === "closed" ? "closed" : "picking"), picked_by: staffRef.current || p.picked_by || null, ...extra });
    } catch (e) { if (!handleSetupError(e)) showToast("บันทึกความคืบหน้าไม่สำเร็จ: " + e.message, "error"); }
  };

  const qtyOf = (p) => (localQty.current[p.id] != null ? localQty.current[p.id] : p.quantity);

  // บันทึกความคืบหน้าที่ยิงแล้ว n ชิ้นของ line หนึ่ง — "ไม่" ตัดสต็อกจริง (รอตัดทีเดียวตอนกดปิดใบหยิบ)
  const registerScan = async (line, n, viaBulk) => {
    const product = productById.get(line.pid) || line.product;
    const key = String(line.pid); const prev = progressRef.current[key] || {};
    const next = { ...progressRef.current, [key]: { scanned: (Number(prev.scanned) || 0) + n, short: Number(prev.short) || 0 } };
    playScanTone("ok");
    setLast({ status: "ok", msg: `✓ ${product.name} — ${next[key].scanned}/${line.required}${viaBulk ? ` (ยืนยันครบ ${next[key].scanned} ชิ้น)` : ""} · รอตัดสต็อกตอนปิดใบ`, product, line: { ...line, scanned: next[key].scanned } });
    await saveProgress(next);
  };

  const processScan = async (raw) => {
    const code = raw.trim(); if (!code) return;
    const pk = code.match(/^PK[-\s]?(\d+)$/i);
    if (pk) { await loadPick(Number(pk[1])); return; }
    const p = pickRef.current;
    if (!p) { playScanTone("bad"); setLast({ status: "bad", msg: `ยังไม่ได้เปิดใบหยิบ — ยิงบาร์โค้ด PK... บนสลิปก่อน (ยิงมา: ${code})` }); return; }
    if (p.pick_status === "closed") { playScanTone("bad"); setLast({ status: "bad", msg: "ใบนี้ตัดสต็อกไปแล้ว บันทึกเพิ่มไม่ได้" }); return; }
    const product = productBySku.get(code.toUpperCase());
    if (!product) { playScanTone("bad"); setLast({ status: "bad", msg: `ไม่รู้จักบาร์โค้ด "${code}" — ไม่ตรงกับ SKU ใดในคลัง` }); return; }
    const line = linesRef.current.find(l => l.pid === product.id);
    if (!line) { playScanTone("bad"); setLast({ status: "bad", msg: `"${product.name}" ไม่ได้อยู่ในใบหยิบนี้ — ไม่นับ เช็คว่าหยิบผิดตัวไหม${unmapped.length ? " (หรือยังไม่ได้จับคู่ชื่อโปร)" : ""}`, product }); return; }
    if (line.scanned + line.short >= line.required) { playScanTone("warn"); setLast({ status: "warn", msg: `"${product.name}" ยิงครบแล้ว (${line.required} ชิ้น) — ไม่นับซ้ำ`, product, line }); return; }
    if (qtyOf(product) <= 0) { playScanTone("warn"); setLast({ status: "warn", msg: `สต็อกในระบบของ "${product.name}" เป็น 0 — เช็คให้แน่ใจว่ามีของจริงก่อนยืนยัน (จะตัดสต็อกตอนปิดใบ)`, product, line }); return; }
    if (!staffRef.current.trim()) { playScanTone("warn"); setLast({ status: "warn", msg: "กรอกชื่อพนักงานก่อนยิง (ช่องมุมขวาบน)", product, line }); return; }
    try { await registerScan(line, 1, false); }
    catch (e) { playScanTone("bad"); setLast({ status: "bad", msg: "บันทึกไม่สำเร็จ: " + e.message, product }); }
  };
  const enqueue = (fn) => { setBusy(true); queueRef.current = queueRef.current.then(fn).catch(() => {}).then(() => setBusy(false)); };
  const handleKey = (e) => { if (e.key !== "Enter") return; const v = scanInput; setScanInput(""); enqueue(() => processScan(v)); };

  // ปุ่ม "ครบ ✓": ต้องยิงติดอย่างน้อย 1 ชิ้นก่อน (ยืนยันว่าหยิบถูกตัว) แล้วค่อยยืนยันเป็นยอดรวมทั้งไลน์ทีเดียว (เช่น ต้องหยิบ 10 ยิงไป 1 กดครบ = ยืนยัน 10) — ยังไม่ตัดสต็อกจริง รอตัดตอนปิดใบ
  const confirmBulk = () => {
    const b = bulkFor; if (!b) return;
    const line = linesRef.current.find(l => l.pid === b.pid); if (!line) return;
    const remaining = line.required - line.scanned - line.short;
    const product = productById.get(line.pid);
    if (remaining <= 0) { setBulkFor(null); return; }
    if (!staffRef.current.trim()) { playScanTone("warn"); setLast({ status: "warn", msg: "กรอกชื่อพนักงานก่อน", product, line }); return; }
    if (qtyOf(product) < line.required) { playScanTone("warn"); setLast({ status: "warn", msg: `สต็อกในระบบของ "${product.name}" มี ${qtyOf(product)} ไม่พอกับที่ต้องหยิบทั้งหมด ${line.required} ชิ้น — เช็คสต็อกก่อนยืนยัน หรือกด "ของขาด" แทนถ้าของจริงมีไม่พอ`, product, line }); return; }
    setBulkFor(null);
    enqueue(async () => { try { await registerScan(line, remaining, true); } catch (e) { playScanTone("bad"); setLast({ status: "bad", msg: "บันทึกไม่สำเร็จ: " + e.message, product }); } });
  };

  // ครบทุกรายการ → เปิดสรุปปิดใบให้อัตโนมัติ (ครั้งเดียวต่อใบ) — ปิดใบต้องกดยืนยันเองเสมอ
  useEffect(() => {
    if (pick && !isClosed && allDone && !summaryShownRef.current) { summaryShownRef.current = true; setShowSummary(true); }
  }, [allDone, pick, isClosed]);

  const markShort = (pid, delta) => {
    const l = linesRef.current.find(x => x.pid === pid); if (!l) return;
    const key = String(pid); const prev = progressRef.current[key] || {};
    const short = Math.max(0, Math.min(l.required - l.scanned, (Number(prev.short) || 0) + delta));
    saveProgress({ ...progressRef.current, [key]: { scanned: l.scanned, short } });
  };

  const saveAlias = async (name, comps) => {
    try {
      await api.upsertAlias(name, comps);
      const m = new Map(aliases); m.set(name, comps); onAliasesChange(m);
      setEditingName(null);
      showToast(comps.length === 0 ? `บันทึก "${name}" = ไม่ตัดสต็อก` : `จับคู่ "${name}" แล้ว — ครั้งหน้าระบบจำให้เอง`);
    } catch (e) { if (!handleSetupError(e)) showToast(e.message, "error"); }
  };

  // ยืนยันปิดใบหยิบ = จุดเดียวที่ตัดสต็อกจริง — ตัดทีเดียวรวมทุกไลน์ตามยอดที่ยิง/ยืนยันไว้ (ก่อนหน้านี้ตัดทันทีทุกครั้งที่ยิง ผู้ใช้ขอให้เลื่อนมาตัดตอนปิดใบแทน)
  const closePick = async () => {
    const p = pickRef.current; if (!p) return;
    setClosing(true);
    try {
      let cutTotal = 0;
      for (const line of linesRef.current) {
        if (line.scanned <= 0) continue;
        const product = productById.get(line.pid) || line.product;
        const cur = qtyOf(product);
        const newQty = cur - line.scanned;
        await api.updateProduct(product.id, { quantity: newQty });
        localQty.current[product.id] = newQty;
        const [tx] = await api.addTransaction({ type: "out", product_id: product.id, quantity: line.scanned, date: localDateStr(), note: `ใบหยิบ PK${p.id}`, by: staffRef.current.trim() || p.picked_by || "" });
        onStockCut(product.id, newQty, tx);
        cutTotal += line.scanned;
      }
      await api.updateOrderScan(p.id, { pick_progress: progressRef.current, pick_status: "closed", pick_closed_at: new Date().toISOString(), picked_by: staffRef.current || p.picked_by || null });
      showToast(`ปิดใบหยิบ PK${p.id} แล้ว — ตัดสต็อก ${cutTotal} ชิ้น`);
      applyPick(null); setLast(null); loadRecent();
    } catch (e) { if (!handleSetupError(e)) showToast(e.message, "error"); }
    setClosing(false);
  };
  const leavePick = () => { applyPick(null); setLast(null); loadRecent(); };

  // ลบใบหยิบทิ้ง — ใช้เมื่อยิงเปิดผิดใบ/ใบซ้ำ ก่อนปิดใบ (ปิดใบไปแล้วตัดสต็อกจริงแล้ว ไม่ให้ลบจากหน้านี้)
  const deletePick = async (id) => {
    if (!window.confirm(`ลบใบหยิบ PK${id} ทิ้งถาวร?\n(ใช้เมื่อยิงเปิดผิดใบ หรือใบซ้ำ — ยังไม่ตัดสต็อกใดๆ)`)) return;
    try {
      await api.deleteOrderScan(id);
      showToast(`ลบใบหยิบ PK${id} แล้ว`);
      setRecent(prev => prev.filter(r => r.id !== id));
      if (pickRef.current?.id === id) { applyPick(null); setLast(null); }
    } catch (e) { showToast(e.message, "error"); }
  };

  const borderColor = last?.status === "ok" ? "#10B981" : last?.status === "bad" ? "#EF4444" : last?.status === "warn" ? "#F59E0B" : "#7C3AED";
  const bannerBg = { ok: "#F0FDF4", bad: "#FEF2F2", warn: "#FFFBEB", info: "#F5F3FF" }[last?.status] || "#F9FAFB";
  const bannerFg = { ok: "#065F46", bad: "#991B1B", warn: "#92400E", info: "#5B21B6" }[last?.status] || "#374151";
  const Thumb = ({ product, size = 46 }) => product?.imageUrl
    ? <img src={product.imageUrl} alt="" style={{ width: size, height: size, objectFit: "cover", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", flexShrink: 0 }} />
    : <div style={{ width: size, height: size, borderRadius: 8, background: "#F3F4F6", color: "#9CA3AF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.45, flexShrink: 0 }}>📦</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 4 }}>📦 ยิงตัดสต็อกจากใบหยิบ</h2>
          <p style={{ fontSize: 13, color: "#6B7280" }}>1) ยิงบาร์โค้ด <b>PK…</b> บนสลิป MyOrder เพื่อเปิดใบ (เปิดปุ๊บขึ้นสถานะ "รอตัดสต็อก" สีเหลืองทันที) · 2) หยิบของพร้อมแผ่นบาร์โค้ดจากช่องเก็บ · 3) ยิงบาร์โค้ด SKU ทีละชิ้น หรือยิงชิ้นแรกแล้วกด "ครบ ✓" ยืนยันยอดรวม โชว์รูปให้เทียบก่อนแพ็ก · <b>ตัดสต็อกจริงตอนกดยืนยันปิดใบเท่านั้น</b></p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#6B7280" }}>พนักงาน</span>
          <input className="inp" value={staffName} onChange={e => setStaff(e.target.value)} placeholder="ชื่อผู้ยิง" style={{ width: 150, padding: "7px 10px", fontSize: 13 }} />
        </div>
      </div>

      {setupError && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B", borderRadius: 12, padding: "10px 14px", fontSize: 13, marginBottom: 12 }}>⚠️ {setupError}</div>
      )}

      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input ref={inputRef} value={scanInput} onChange={e => setScanInput(e.target.value)} onKeyDown={handleKey} autoFocus
            placeholder={pick ? `ใบ PK${pick.id} เปิดอยู่ — ยิงบาร์โค้ด SKU สินค้า...` : "ยิงบาร์โค้ดใบหยิบ (PK...) ที่นี่..."}
            style={{ flex: 1, minWidth: 260, background: "#F9FAFB", border: `2.5px solid ${borderColor}`, borderRadius: 12, padding: "14px 16px", color: "#111827", fontSize: 18, outline: "none", fontFamily: "monospace", transition: "border-color 0.15s" }} />
          {pick && (
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setShowSummary(true)} style={{ background: "#7C3AED", color: "#fff", border: "none", borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{isClosed ? "📋 ดูสรุป" : "✅ ปิดใบ / สรุป"}</button>
              <button onClick={leavePick} style={{ background: "#F3F4F6", color: "#6B7280", border: "none", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>✕ ออกจากใบ</button>
              {!isClosed && (
                <button onClick={() => deletePick(pick.id)} title="ลบใบนี้ทิ้ง เช่น เปิดผิดใบ/ใบซ้ำ"
                  style={{ background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: 10, padding: "10px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>🗑️ ลบใบ</button>
              )}
            </div>
          )}
        </div>
        {last && (
          <div style={{ marginTop: 10, padding: "9px 14px", borderRadius: 10, background: bannerBg, color: bannerFg, fontSize: 14, fontWeight: 600, display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: 18 }}>{last.status === "ok" ? "✅" : last.status === "bad" ? "⛔" : last.status === "warn" ? "⚠️" : "ℹ️"}</span>
            <span>{last.msg}</span>
          </div>
        )}
        {(loadingPick || busy) && <div style={{ marginTop: 8, fontSize: 12, color: "#6B7280" }}>⏳ {loadingPick ? "กำลังโหลดใบหยิบ..." : "กำลังบันทึก..."}</div>}
      </div>

      {!pick && (
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontWeight: 700, color: "#111827", fontSize: 14 }}>
              🧾 {recentStatusFilter === "closed" ? "ใบหยิบที่ตัดสต็อกแล้ว" : recentStatusFilter === "all" ? "ใบหยิบทั้งหมด" : "ใบหยิบที่ยังไม่ตัดสต็อก (ค้างอยู่)"}
            </div>
            <button onClick={loadRecent} style={btnStyle("#F3F4F6", "#6B7280")}>🔄 รีเฟรช</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "#6B7280" }}>วันที่:</span>
              {[["all", "ทั้งหมด"], ["today", "วันนี้"], ["yesterday", "เมื่อวาน"], ["month", "เดือนนี้"], ["custom", "กำหนดเอง"]].map(([v, l]) => (
                <button key={v} onClick={() => setRecentPreset(v)}
                  style={{ background: recentPreset === v ? "#7C3AED" : "#F3F4F6", color: recentPreset === v ? "#fff" : "#6B7280", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{l}</button>
              ))}
              {recentPreset === "custom" && (
                <>
                  <input type="date" className="inp" style={{ padding: "6px 8px", fontSize: 12 }} value={recentFrom} onChange={e => setRecentFrom(e.target.value)} />
                  <span style={{ fontSize: 12, color: "#6B7280" }}>ถึง</span>
                  <input type="date" className="inp" style={{ padding: "6px 8px", fontSize: 12 }} value={recentTo} onChange={e => setRecentTo(e.target.value)} />
                </>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "#6B7280" }}>สถานะ:</span>
              {[["all", "ทั้งหมด"], ["pending", "รอตัดสต็อก"], ["closed", "ตัดสต็อกแล้ว"]].map(([v, l]) => (
                <button key={v} onClick={() => setRecentStatusFilter(v)}
                  style={{ background: recentStatusFilter === v ? "#7C3AED" : "#F3F4F6", color: recentStatusFilter === v ? "#fff" : "#6B7280", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{l}</button>
              ))}
            </div>
          </div>
          {loadingRecent && <div style={{ color: "#9CA3AF", fontSize: 13, padding: 12 }}>กำลังโหลด...</div>}
          {!loadingRecent && recent.length === 0 && <div style={{ color: "#9CA3AF", fontSize: 13, padding: 20, textAlign: "center" }}>ไม่มีใบหยิบตามเงื่อนไขที่เลือก — ยิงบาร์โค้ด PK บนสลิป หรือรอ extension ส่งเข้ามา</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
            {recent.map(r => {
              const n = Array.isArray(r.products) ? r.products.length : 0;
              const prog = r.pick_progress && typeof r.pick_progress === "object" ? Object.values(r.pick_progress).reduce((s, v) => s + (Number(v.scanned) || 0), 0) : 0;
              const rClosed = r.pick_status === "closed";
              return (
                <div key={r.id} onClick={() => loadPick(r.id)}
                  style={{ position: "relative", border: "1px solid #E5E7EB", borderRadius: 12, padding: "12px 14px", cursor: "pointer", background: rClosed ? "#F0FDF4" : r.pick_status === "picking" ? "#FFFBEB" : "#FAFAFE" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "#7C3AED"} onMouseLeave={e => e.currentTarget.style.borderColor = "#E5E7EB"}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#7C3AED", fontSize: 15 }}>PK{r.id}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: rClosed ? "#D1FAE5" : r.pick_status === "picking" ? "#FEF3C7" : "#EDE9FE", color: rClosed ? "#065F46" : r.pick_status === "picking" ? "#92400E" : "#5B21B6", fontWeight: 600 }}>{pickStatusLabel(r.pick_status)}</span>
                      {!rClosed && (
                        <button onClick={(e) => { e.stopPropagation(); deletePick(r.id); }} title="ลบใบนี้ทิ้ง"
                          style={{ background: "none", border: "none", color: "#DC2626", cursor: "pointer", fontSize: 13, padding: 2 }}>🗑️</button>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: "#111827", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.page_name || "ไม่ระบุเพจ"}</div>
                  <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>{fmtDT(r.created_at)} · {r.total_orders || 0} ออเดอร์ · {n} รายการ {r.total_items || 0} หน่วยขาย{prog ? ` · ยิงแล้ว ${prog} ชิ้น` : ""}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pick && (
        <div style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(280px, 380px)", gap: 14, alignItems: "start" }}>
          <div style={{ minWidth: 0, order: narrow ? 2 : 1 }}>
            {/* ── รายการที่ยังไม่รู้ว่าคือ SKU ไหน (ต้องจับคู่ก่อน ถึงจะโผล่ในรายการหยิบ) ── */}
            {unmapped.length > 0 && !isClosed && (
              <div style={{ background: "#fff", border: "1px solid #FDE68A", borderRadius: 16, overflow: "hidden", marginBottom: 14 }}>
                <div style={{ padding: "10px 16px", background: "#FFFBEB", borderBottom: "1px solid #FDE68A", fontSize: 13, fontWeight: 700, color: "#92400E" }}>⚠ {unmapped.length} ชื่อจาก myorder ยังไม่รู้ว่าคือสินค้าไหนในคลัง — จับคู่ครั้งเดียว ระบบจำตลอด</div>
                {unmapped.map(it => (
                  <div key={it.name} style={{ padding: "10px 16px", borderBottom: "1px solid #F3F4F6" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{it.name}</div>
                        <div style={{ fontSize: 12, color: "#6B7280" }}>สั่ง {it.orderQty} หน่วย{it.missing ? " · สินค้าที่เคยจับคู่ไว้ถูกลบออกจากคลังแล้ว" : ""}</div>
                      </div>
                      {editingName !== it.name && <button onClick={() => setEditingName(it.name)} style={btnStyle("#7C3AED", "#fff", { padding: "7px 14px" })}>🔗 จับคู่</button>}
                    </div>
                    {editingName === it.name && <AliasEditor name={it.name} products={products} initial={null} onSave={comps => saveAlias(it.name, comps)} onCancel={() => setEditingName(null)} onAddProduct={onAddProduct} />}
                  </div>
                ))}
              </div>
            )}

            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, overflow: "hidden" }}>
              <div style={{ padding: "14px 16px", borderBottom: "1px solid #F3F4F6", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#7C3AED", fontSize: 18 }}>PK{pick.id}</span>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: isClosed ? "#F3F4F6" : "#EDE9FE", color: isClosed ? "#6B7280" : "#5B21B6", fontWeight: 600 }}>{pickStatusLabel(pick.pick_status)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#111827", fontWeight: 600, marginTop: 2 }}>{pick.page_name || "ไม่ระบุเพจ"}</div>
                  <div style={{ fontSize: 12, color: "#6B7280" }}>{fmtDT(pick.created_at)} · {pick.total_orders || 0} ออเดอร์ · {items.length} ชื่อสินค้า{pick.note ? ` · 📝 ${pick.note}` : ""}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#111827", fontFamily: "monospace" }}>{totalScanned}<span style={{ color: "#9CA3AF", fontSize: 16 }}>/{totalRequired}</span></div>
                  <div style={{ fontSize: 11, color: "#6B7280" }}>ชิ้นที่ยิงแล้ว / ต้องหยิบ ({lines.length} SKU)</div>
                </div>
              </div>
              <div>
                {lines.map(l => {
                  const remaining = l.required - l.scanned - l.short;
                  const done = l.scanned >= l.required;
                  const partial = remaining <= 0 && l.short > 0;
                  const rowBg = done ? "#F0FDF4" : partial ? "#FEF3C7" : "#fff";
                  const isBulk = bulkFor?.pid === l.pid;
                  const srcText = l.sources.map(s => `${s.name} ×${s.orderQty}${s.per > 1 ? ` (=${s.per} ชิ้น/หน่วย)` : ""}`).join(" · ");
                  return (
                    <div key={l.pid} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #F3F4F6", background: rowBg }}>
                      <Thumb product={l.product} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{l.product.name} <span style={{ fontFamily: "monospace", fontWeight: 400, color: "#6B7280", fontSize: 12 }}>{l.product.sku}</span></div>
                        <div style={{ fontSize: 11.5, color: "#6B7280", marginTop: 2 }} title={srcText}>จาก: {srcText}</div>
                        <div style={{ fontSize: 11.5, color: "#6B7280" }}>คงเหลือในคลัง {qtyOf(l.product)} {l.product.unit || ""}{l.product.location && l.product.location !== "-" ? ` · ช่อง ${l.product.location}` : ""}
                          {!isClosed && <button onClick={() => setEditingName(l.sources[0].name)} style={{ marginLeft: 6, background: "none", border: "none", color: "#7C3AED", fontSize: 11, cursor: "pointer", textDecoration: "underline" }}>แก้การจับคู่</button>}
                        </div>
                        {editingName && l.sources.some(s => s.name === editingName) && !isClosed && (
                          <AliasEditor name={editingName} products={products} initial={aliases.get(editingName) || items.find(it => it.name === editingName)?.comps || null}
                            onSave={comps => saveAlias(editingName, comps)} onCancel={() => setEditingName(null)} onAddProduct={onAddProduct} />
                        )}
                        {isBulk && (
                          <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 10, padding: "8px 10px" }} data-nofocus>
                            <span style={{ fontSize: 12, color: "#5B21B6", fontWeight: 600 }}>ยืนยันว่าหยิบครบทั้งหมด {l.required} ชิ้น? (ยิงไปแล้ว {l.scanned} เหลืออีก {remaining} — รอตัดสต็อกตอนปิดใบ)</span>
                            <button autoFocus onClick={confirmBulk} onKeyDown={e => { if (e.key === "Escape") setBulkFor(null); }} style={btnStyle("#7C3AED", "#fff", { padding: "7px 14px" })}>✓ ยืนยันครบ {l.required}</button>
                            <button onClick={() => setBulkFor(null)} style={btnStyle("none", "#6B7280")}>ยกเลิก</button>
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 800, color: done ? "#059669" : partial ? "#B45309" : "#111827" }}>{l.scanned}<span style={{ color: "#9CA3AF", fontSize: 14 }}>/{l.required}</span></div>
                        {l.short > 0 && <div style={{ fontSize: 11, color: "#B45309", fontWeight: 700 }}>ของขาด {l.short}</div>}
                        {!isClosed && (
                          <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", marginTop: 4 }}>
                            {remaining > 0 && (
                              <button disabled={l.scanned === 0 || busy} onClick={() => setBulkFor({ pid: l.pid })}
                                title={l.scanned === 0 ? "ยิงชิ้นแรกก่อน เพื่อยืนยันว่าหยิบถูกตัว แล้วค่อยกดครบ" : `ยืนยันว่าหยิบครบทั้งหมด ${l.required} ชิ้น`}
                                style={btnStyle(l.scanned === 0 ? "#F3F4F6" : "#D1FAE5", l.scanned === 0 ? "#9CA3AF" : "#065F46", { fontSize: 11, padding: "3px 8px", cursor: l.scanned === 0 ? "not-allowed" : "pointer" })}>ครบ ✓</button>
                            )}
                            <button disabled={remaining <= 0} onClick={() => markShort(l.pid, 1)} title="ของขาดสต็อกจริง หยิบไม่ได้ 1 ชิ้น"
                              style={btnStyle("#FEF3C7", "#92400E", { fontSize: 11, padding: "3px 8px", border: "1px solid #FDE68A", opacity: remaining <= 0 ? 0.4 : 1 })}>ของขาด +1</button>
                            {l.short > 0 && <button onClick={() => markShort(l.pid, -1)} style={btnStyle("#F3F4F6", "#6B7280", { fontSize: 11, padding: "3px 8px" })}>↺</button>}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {lines.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>{unmapped.length ? "จับคู่ชื่อสินค้าด้านบนก่อน รายการที่ต้องหยิบจะโผล่ตรงนี้" : "ใบนี้ไม่มีรายการที่ต้องตัดสต็อก"}</div>}
                {items.some(it => it.skip) && <div style={{ padding: "8px 16px", fontSize: 11.5, color: "#9CA3AF" }}>ไม่ตัดสต็อก: {items.filter(it => it.skip).map(it => `${it.name} ×${it.orderQty}`).join(" · ")}</div>}
              </div>
            </div>
          </div>

          <div style={{ background: "#fff", border: `2px solid ${last?.product ? borderColor : "#E5E7EB"}`, borderRadius: 16, padding: 14, position: narrow ? "static" : "sticky", top: 90, order: narrow ? 1 : 2, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 600, marginBottom: 8 }}>👁 เทียบของในมือกับรูปนี้ก่อนแพ็ก</div>
            {last?.product ? (
              <div>
                {last.product.imageUrl
                  ? <img src={last.product.imageUrl} alt="" style={{ width: "100%", maxHeight: narrow ? 220 : 400, objectFit: "contain", borderRadius: 12, background: "#F9FAFB", border: "1px solid #E5E7EB" }} />
                  : <div style={{ width: "100%", aspectRatio: "1 / 1", maxHeight: 320, borderRadius: 12, background: "#F3F4F6", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#9CA3AF", gap: 6, padding: 16, textAlign: "center" }}>
                      <span style={{ fontSize: 48 }}>📦</span><span style={{ fontSize: 12 }}>สินค้านี้ยังไม่มีรูปในระบบ — เพิ่มรูปได้ที่ปุ่ม ✏️ แก้ไข ในหน้าคลังสินค้า</span>
                    </div>}
                <div style={{ marginTop: 10, fontSize: 17, fontWeight: 800, color: "#111827", lineHeight: 1.3 }}>{last.product.name}</div>
                <div style={{ fontSize: 13, color: "#6B7280", fontFamily: "monospace", marginTop: 2 }}>{last.product.sku}{last.product.location && last.product.location !== "-" ? ` · ช่อง ${last.product.location}` : ""}</div>
                {last.line && <div style={{ marginTop: 8, fontSize: 22, fontWeight: 800, fontFamily: "monospace", color: last.status === "ok" ? "#059669" : bannerFg }}>{last.line.scanned}<span style={{ color: "#9CA3AF", fontSize: 14 }}>/{last.line.required} ชิ้น</span></div>}
                <div style={{ marginTop: 6, fontSize: 12, color: bannerFg, fontWeight: 600 }}>{last.msg}</div>
              </div>
            ) : (
              <div style={{ padding: "40px 10px", textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>ยิงบาร์โค้ด SKU แล้วรูปสินค้าจะขึ้นตรงนี้ทันที</div>
            )}
          </div>
        </div>
      )}

      {showSummary && pick && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.5)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, backdropFilter: "blur(6px)" }} onClick={() => setShowSummary(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 560, maxHeight: "90vh", overflow: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ padding: "18px 22px 12px", borderBottom: "1px solid #F3F4F6" }}>
              <div style={{ fontWeight: 700, fontSize: 17, color: "#111827" }}>{isClosed ? "📋 สรุปใบหยิบ" : allDone ? "🎉 ยิงครบทุกรายการแล้ว" : "📋 สรุปก่อนปิดใบ"} <span style={{ fontFamily: "monospace", color: "#7C3AED" }}>PK{pick.id}</span></div>
              <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>{pick.page_name || ""} · ผู้ยิง {staffName || pick.picked_by || "-"} · รวม {totalScanned}/{totalRequired} ชิ้น</div>
            </div>
            <div style={{ padding: "8px 22px" }}>
              {lines.map(l => {
                const rem = l.required - l.scanned - l.short;
                const st = l.scanned >= l.required ? ["ครบ", "#059669"] : rem <= 0 ? [`ของขาด ${l.short}`, "#B45309"] : [`ขาดอีก ${rem}`, "#DC2626"];
                return (
                  <div key={l.pid} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #F3F4F6", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{l.product.name}</div>
                      <div style={{ fontSize: 11, color: "#6B7280" }}>{l.product.sku} · {l.sources.map(s => `${s.name} ×${s.orderQty}`).join(", ")}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 14 }}>{l.scanned}/{l.required}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: st[1] }}>{st[0]}</div>
                    </div>
                  </div>
                );
              })}
              {unmapped.map(it => (
                <div key={it.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #F3F4F6", gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{it.name} <span style={{ color: "#6B7280", fontWeight: 400 }}>×{it.orderQty}</span></div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#B45309" }}>ยังไม่จับคู่ — ไม่ถูกตัด</div>
                </div>
              ))}
              {items.filter(it => it.skip).map(it => (
                <div key={it.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #F3F4F6", gap: 10, opacity: 0.6 }}>
                  <div style={{ fontSize: 13, color: "#111827" }}>{it.name} <span style={{ color: "#6B7280" }}>×{it.orderQty}</span></div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280" }}>ไม่ตัดสต็อก</div>
                </div>
              ))}
              {!isClosed && unmapped.length > 0 && <div style={{ marginTop: 10, fontSize: 12, color: "#B45309", background: "#FFFBEB", borderRadius: 8, padding: "8px 10px" }}>⚠ มี {unmapped.length} ชื่อยังไม่จับคู่ SKU — ปิดใบได้ แต่รายการเหล่านั้นจะไม่ถูกตัดสต็อก</div>}
              {!isClosed && !allDone && unmapped.length === 0 && <div style={{ marginTop: 10, fontSize: 12, color: "#92400E", background: "#FFFBEB", borderRadius: 8, padding: "8px 10px" }}>ยังยิงไม่ครบ — ถ้าของขาดจริงให้กด "ของขาด +1" ที่รายการก่อน เพื่อให้สรุปตรงกับความจริง</div>}
            </div>
            <div style={{ padding: "12px 22px 18px", display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowSummary(false)} style={{ background: "#F3F4F6", color: "#374151", border: "none", borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{isClosed ? "ปิด" : "ยิงต่อ"}</button>
              {!isClosed && <button onClick={closePick} disabled={closing} style={{ background: "linear-gradient(135deg,#7C3AED,#3B82F6)", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: closing ? 0.6 : 1 }}>{closing ? "⏳ กำลังตัดสต็อก..." : `✅ ยืนยันปิดใบ + ตัดสต็อก ${totalScanned} ชิ้น`}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════ วางรายการจาก MyOrder — parser เดียวกับเครื่องมือ backlog-check (แยกเก็บ scanDate + วันที่สั่งซื้อจริงต่อรายการ) ═══════════
function parseBacklogPaste(text) {
  const pad2n = (n) => String(n).padStart(2, "0");
  const lines = String(text || "").split(/\r?\n/).map(s => s.replace(/^[\s•\-–·📦🚚💳💵📄🗓️*]+/, "").trim()).filter(Boolean);
  const map = new Map(); // name -> { qty, orderDate:'YYYY-MM-DD'|null }
  let pending = null, scanDate = null;
  const isNoise = (l) => /ออเดอร์|บาท|รวม\s*\d|ทั้งหมด|COD|Bank|โอนเงิน|การชำระ|ขนส่ง|นับจาก|วันที่สแกน/i.test(l);
  const add = (name, qty, orderDate) => {
    name = name.replace(/\s+/g, " ").trim(); if (!name || !(qty > 0)) return;
    const cur = map.get(name) || { qty: 0, orderDate: null };
    cur.qty += qty;
    if (orderDate && (!cur.orderDate || orderDate < cur.orderDate)) cur.orderDate = orderDate;
    map.set(name, cur);
  };
  for (const l of lines) {
    let m;
    if ((m = l.match(/วันที่สแกน\s*[:：]?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/))) {
      const [, dd, mm, yyyy] = m; scanDate = `${yyyy}-${pad2n(mm)}-${pad2n(dd)}`; pending = null; continue;
    }
    if ((m = l.match(/^(.+?)\t\s*([\d,]+)\s*ชิ้น\s*\t\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/))) {
      const orderDate = `${m[5]}-${pad2n(m[4])}-${pad2n(m[3])}`; add(m[1], parseInt(m[2].replace(/,/g, ""), 10), orderDate); pending = null; continue;
    }
    if ((m = l.match(/^(.+?)\s*[\t ]\s*([\d,]+)\s*ชิ้น\s*$/)) && !isNoise(m[1])) { add(m[1], parseInt(m[2].replace(/,/g, ""), 10)); pending = null; continue; }
    if ((m = l.match(/^([\d,]+)\s*ชิ้น\s*$/))) { if (pending) add(pending, parseInt(m[1].replace(/,/g, ""), 10)); pending = null; continue; }
    if ((m = l.match(/^(.+?)\t\s*([\d,]+)\s*$/)) && !isNoise(m[1])) { add(m[1], parseInt(m[2].replace(/,/g, ""), 10)); pending = null; continue; }
    if (isNoise(l) || /^[\d,.\s]+$/.test(l)) { pending = null; continue; }
    pending = l;
  }
  return { items: [...map.entries()].map(([name, v]) => ({ name, qty: v.qty, orderDate: v.orderDate })), scanDate };
}

// การจับคู่เอง + ประวัติ "ค้างมากี่วัน" — เก็บ localStorage ของเครื่อง/เบราว์เซอร์นี้เท่านั้น (เป็นแค่ตัวช่วยเดา ไม่ใช่ข้อมูลที่ต้องแชร์กันทุกคน)
const BACKLOG_MANUAL_KEY = "backlog_notes_manual_v1"; // { [myorderName]: productId|null }
const BACKLOG_AGE_HISTORY_KEY = "backlog_notes_age_history_v1"; // { [productId]: {firstSeen,lastSeen,lastQty,source} }
const backlogAgeTone = (age) => age >= 14 ? "#DC2626" : age >= 5 ? "#B45309" : "#475569";
const backlogAgeBg = (age) => age >= 14 ? "#FEE2E2" : age >= 5 ? "#FEF3C7" : "#F1F5F9";

// ═══════════ บันทึกสินค้าค้างส่ง — วางรายการจาก MyOrder เทียบกับสต็อก/รอเข้าจริงแบบเต็ม (เหมือนหน้าหลักของเครื่องมือ backlog-check) แล้วบันทึกเฉพาะ "ค้างส่ง (สต็อกไม่มีของ)" + ที่จับคู่กับคลังไม่ได้ ไว้เป็นโน้ตกันตกหล่น ═══════════
// เก็บที่ตาราง backlog_notes แถวเดียว id=1 (jsonb) ให้ทุกคน/ทุกเครื่องเห็นตรงกัน (ต้องรัน backlog-notes-setup.sql ก่อนถึงจะใช้ได้)
// บันทึกอัตโนมัติทุกครั้งที่กด "เทียบข้อมูลสินค้า" สำเร็จ (ไม่ต้องกดปุ่ม "บันทึก" แยกอีกต่อไป — ปุ่มยังอยู่ไว้กดบันทึกซ้ำเองได้เผื่อบันทึกอัตโนมัติล้มเหลว)
// แก้ไข/ลบ/ใส่หมายเหตุทีละรายการได้โดยไม่กระทบวันที่บันทึกล่าสุด, การบันทึกซ้ำ (อัตโนมัติหรือกดเอง) จะไม่ทับหมายเหตุ/จำนวนรอเข้าที่กรอกเองไว้ (merge จาก saved.items เดิมเสมอ)
function BacklogNotesPanel({ products, showToast, onViewHistory }) {
  const [paste, setPaste] = useState("");
  const [parseInfo, setParseInfo] = useState("");
  const [aliases, setAliases] = useState(null); // Map(myorder_name -> components[]) | null ระหว่างโหลด
  const [rows, setRows] = useState(null); // null = ยังไม่เคยกดเทียบรอบนี้ — ทุกแถวที่จับคู่ได้ (my>0) ไม่ว่าสต็อกจะเหลือหรือไม่
  const [unmatched, setUnmatched] = useState([]);
  const [filterMode, setFilterMode] = useState("over"); // "over" | "noStock" | "all"
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("desc");
  const [manual, setManual] = useState(() => { try { return JSON.parse(localStorage.getItem(BACKLOG_MANUAL_KEY) || "{}"); } catch { return {}; } });
  const [saved, setSaved] = useState(undefined); // undefined = กำลังโหลด, null = ยังไม่เคยบันทึก
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set()); // ติ๊กเลือกหลายรายการในตารางบันทึก เพื่อลบพร้อมกัน
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [savedFilter, setSavedFilter] = useState("all"); // "all" | "over" | "short" — แท็บย่อยของตารางบันทึก (คนละอันกับ filterMode ของตารางเทียบข้อมูลด้านบน)
  const [savedSearch, setSavedSearch] = useState("");
  const [savedSortCol, setSavedSortCol] = useState(null); // เรียงคอลัมน์ในตารางบันทึก — คนละ state กับ sortCol ของตารางเทียบข้อมูลด้านบน
  const [savedSortDir, setSavedSortDir] = useState("desc");

  useEffect(() => {
    api.getAliases().then(rows2 => {
      const m = new Map();
      (rows2 || []).forEach(r => m.set(String(r.myorder_name || "").trim(), Array.isArray(r.components) ? r.components : []));
      setAliases(m);
    }).catch(() => setAliases(new Map()));
  }, []);

  const loadSaved = () => { api.getBacklogNotes().then(row => setSaved(row)).catch(() => setSaved(null)); };
  useEffect(() => { loadSaved(); }, []);

  const byId = useMemo(() => new Map(products.map(p => [String(p.id), p])), [products]);

  const doCompare = () => {
    if (!aliases) return;
    const { items, scanDate: pasteScanDate } = parseBacklogPaste(paste);
    const scanDate = pasteScanDate || todayStr();
    setParseInfo(items.length ? `อ่านได้ ${items.length} ชื่อ รวม ${items.reduce((s, i) => s + i.qty, 0).toLocaleString("th-TH")} ชิ้น` : "ยังอ่านชื่อสินค้าไม่ได้ — ตรวจว่าบรรทัดลงท้ายด้วย 'ชิ้น'");
    if (!items.length) { setRows(null); setUnmatched([]); return; }

    const per = new Map();
    const slot = (pid) => { const k = String(pid); if (!per.has(k)) per.set(k, { p: byId.get(k), my: 0, mySrc: [], oldestOrderDate: null }); return per.get(k); };
    const mergeOrderDate = (s, od) => { if (od && (!s.oldestOrderDate || od < s.oldestOrderDate)) s.oldestOrderDate = od; };
    const um = [];
    items.forEach(it => {
      const key = it.name;
      if (Object.prototype.hasOwnProperty.call(manual, key)) {
        const pid = manual[key];
        if (pid == null || !byId.has(String(pid))) { um.push({ ...it, how: pid == null ? "ตั้งเองว่าไม่มีในคลัง" : "สินค้าที่ตั้งไว้ถูกลบ" }); return; }
        const s = slot(pid); s.my += it.qty; s.mySrc.push({ name: key, qty: it.qty, tag: "manual" }); mergeOrderDate(s, it.orderDate); return;
      }
      let comps = aliases.get(key);
      if (comps === undefined) {
        const nk = normName(key);
        for (const [an, ac] of aliases) if (normName(an) === nk) { comps = ac; break; }
      }
      if (comps !== undefined) {
        if (!comps.length) { um.push({ ...it, how: "ตารางจับคู่บอกว่าไม่มีในคลัง" }); return; }
        let anyBad = false;
        comps.forEach(c => {
          if (!byId.has(String(c.product_id))) { anyBad = true; return; }
          const q = (Number(c.qty) || 1) * it.qty;
          const s = slot(c.product_id); s.my += q; s.mySrc.push({ name: key + (Number(c.qty) > 1 ? ` ×${c.qty}` : ""), qty: q, tag: "alias" }); mergeOrderDate(s, it.orderDate);
        });
        if (anyBad) um.push({ ...it, how: "สินค้าในตารางจับคู่ถูกลบ" });
        return;
      }
      const p = scoreMatchProduct(key, products);
      if (p) { const s = slot(p.id); s.my += it.qty; s.mySrc.push({ name: key, qty: it.qty, tag: "guess" }); mergeOrderDate(s, it.orderDate); }
      else um.push({ ...it, how: "ไม่พบสินค้าที่ตรงกัน" });
    });

    let history = {}; try { history = JSON.parse(localStorage.getItem(BACKLOG_AGE_HISTORY_KEY) || "{}"); } catch {}
    // ใช้ร่วมกันทั้งรายการที่จับคู่ได้ (คีย์ = product id) และจับคู่ไม่ได้ (คีย์ = "u:"+ชื่อ) เพื่อให้ "ค้างมา (วัน)"
    // คำนวณด้วยกติกาเดียวกันทั้งคู่ — เชื่อวันที่สั่งซื้อจากรายการล่าสุดที่วางเสมอ ไม่จำวันเก่าที่สุดไว้ตลอด
    // (ของค้างรอบก่อนถูกส่งไปแล้ว วางรายการใหม่ อายุเริ่มนับจากวันที่สั่งซื้อรอบล่าสุดทันที ไม่ต้องกด ↺ เอง)
    const mergeAge = (key, orderDate, qty) => {
      let h = history[key];
      if (orderDate) h = { firstSeen: orderDate, lastSeen: scanDate, lastQty: qty, source: "order" };
      else if (!h) h = { firstSeen: scanDate, lastSeen: scanDate, lastQty: qty, source: "scan" };
      else { if (scanDate < h.firstSeen) h.firstSeen = scanDate; if (scanDate > h.lastSeen) h.lastSeen = scanDate; h.lastQty = qty; }
      history[key] = h;
      const age = Math.max(0, Math.floor((new Date(todayStr() + "T00:00:00") - new Date(h.firstSeen + "T00:00:00")) / 86400000));
      return { age, firstSeen: h.firstSeen, dateIsReal: h.source === "order" };
    };
    const built = [...per.values()].filter(r => r.p && r.my > 0).map(r => {
      const stock = Number(r.p.quantity) || 0;
      const ageInfo = mergeAge(String(r.p.id), r.oldestOrderDate, r.my);
      return { ...r, stock, over: stock > 0, inc: r.p.qtyOnOrder || 0, incSrc: r.p.incomingSources || [], ...ageInfo };
    });
    const umAged = um.map(u => ({ ...u, ...mergeAge("u:" + u.name, u.orderDate, u.qty) }));
    try { localStorage.setItem(BACKLOG_AGE_HISTORY_KEY, JSON.stringify(history)); } catch {}

    built.sort((a, b) => (b.over - a.over) || b.my - a.my);
    setRows(built);
    setUnmatched(umAged);
    saveItems(buildSaveItems(built, umAged), "บันทึกอัตโนมัติแล้ว");
  };

  // จับคู่เอง/แก้ไขวันครั้งไหนแล้ว เทียบใหม่อัตโนมัติให้เห็นผลทันที (ถ้าเคยกดเทียบไปแล้วรอบนี้)
  useEffect(() => { if (rows != null) doCompare(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [manual]);
  useEffect(() => { try { localStorage.setItem(BACKLOG_MANUAL_KEY, JSON.stringify(manual)); } catch {} }, [manual]);

  const setManualMatch = (name, v) => setManual(prev => { const next = { ...prev }; if (v === "auto") delete next[name]; else next[name] = v === "none" ? null : Number(v); return next; });
  const resetAge = (pid) => {
    let history = {}; try { history = JSON.parse(localStorage.getItem(BACKLOG_AGE_HISTORY_KEY) || "{}"); } catch {}
    delete history[String(pid)];
    try { localStorage.setItem(BACKLOG_AGE_HISTORY_KEY, JSON.stringify(history)); } catch {}
    doCompare();
  };
  const clearAllAge = () => {
    if (!window.confirm('ล้างวันที่ "ค้างมา" ของสินค้าทุกตัวในเครื่องนี้ ต้องการดำเนินการต่อไหม?')) return;
    try { localStorage.removeItem(BACKLOG_AGE_HISTORY_KEY); } catch {}
    doCompare();
  };

  const over = useMemo(() => (rows || []).filter(r => r.over), [rows]);
  const noStock = useMemo(() => (rows || []).filter(r => !r.over), [rows]);
  const oldest = useMemo(() => (rows && rows.length) ? rows.reduce((a, b) => (b.age > a.age ? b : a)) : null, [rows]);
  const shown = useMemo(() => {
    let base = filterMode === "over" ? over : filterMode === "noStock" ? noStock : (rows || []);
    if (sortCol) {
      const dir = sortDir === "asc" ? 1 : -1;
      base = [...base].sort((a, b) => sortCol === "name" ? dir * a.p.name.localeCompare(b.p.name, "th") : ((a[sortCol] - b[sortCol]) * dir || a.p.name.localeCompare(b.p.name, "th")));
    }
    return base;
  }, [rows, over, noStock, filterMode, sortCol, sortDir]);
  const toggleSort = (col) => { if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortCol(col); setSortDir(col === "name" ? "asc" : "desc"); } };

  // รักษาหมายเหตุต่อรายการ + จำนวนรอเข้าที่กรอกเองไว้ (เฉพาะรายการจับคู่ไม่ได้) ถ้ารายการเดิมยังอยู่ในการบันทึกครั้งนี้
  // บันทึกทุกรายการที่จับคู่ได้ (ไม่ว่าสต็อกจะเหลือหรือไม่) + ที่จับคู่กับคลังไม่ได้ — ให้หน้าบันทึกมีของมีแต่ยังไม่ส่งด้วย ไม่ใช่แค่ของหมดสต็อก — พร้อมแนบ "ค้างมา (วัน)" ของแต่ละรายการไว้ด้วย
  const buildSaveItems = (builtRows, umRows) => {
    const oldById = new Map((saved?.items || []).map(it => [it.id, it]));
    return [
      ...builtRows.map(r => ({
        id: String(r.p.id), name: r.p.name, sku: r.p.sku, myQty: r.my, stock: r.stock, incQty: r.inc, matched: true,
        itemNote: oldById.get(String(r.p.id))?.itemNote || "", age: r.age, firstSeen: r.firstSeen, dateIsReal: r.dateIsReal,
      })),
      ...umRows.map(u => ({
        id: "u:" + u.name, name: u.name, sku: null, myQty: u.qty, stock: null, incQty: oldById.get("u:" + u.name)?.incQty ?? null, matched: false,
        itemNote: oldById.get("u:" + u.name)?.itemNote || "", age: u.age, firstSeen: u.firstSeen, dateIsReal: u.dateIsReal,
      })),
    ];
  };
  // บันทึกลง Supabase — เรียกอัตโนมัติทุกครั้งที่กด "เทียบข้อมูลสินค้า" สำเร็จ (ไม่ต้องกดปุ่ม "บันทึก" แยกอีกต่อไป)
  const saveItems = async (items, toastMsg) => {
    setSaving(true);
    try {
      const row = await api.saveBacklogNotes(items);
      setSaved(Array.isArray(row) ? row[0] : row);
      if (toastMsg) showToast(`${toastMsg} (${items.length} รายการ)`);
    } catch (e) {
      showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
    } finally { setSaving(false); }
  };
  const doSave = async () => { if (rows != null) await saveItems(buildSaveItems(rows, unmatched), "บันทึกแล้ว"); };

  const updateSavedItems = async (nextItems) => {
    const prevSaved = saved;
    setSaved(prev => ({ ...prev, items: nextItems }));
    try { await api.patchBacklogNoteItems(nextItems); }
    catch (e) { showToast("อัปเดตไม่สำเร็จ: " + e.message, "error"); setSaved(prevSaved); }
  };
  const editQty = (it) => {
    const v = window.prompt(`แก้ไขจำนวนค้างส่งจาก MyOrder ของ "${it.name}"`, it.myQty);
    if (v == null) return;
    const num = parseInt(String(v).replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(num) || num < 0) { window.alert("กรุณาใส่ตัวเลขจำนวนเต็มที่ถูกต้อง"); return; }
    updateSavedItems(saved.items.map(x => x.id === it.id ? { ...x, myQty: num } : x));
  };
  // กรอกจำนวน "สินค้ารอเข้า" เองได้ — เฉพาะรายการที่จับคู่กับ StockMaster ไม่ได้ (ไม่มี SKU ให้ดึงยอดจริงมาอัตโนมัติ)
  const editIncQty = (it) => {
    const v = window.prompt(`กรอกจำนวนสินค้ารอเข้าของ "${it.name}" (เว้นว่างไว้ถ้าไม่ทราบ)`, it.incQty ?? "");
    if (v == null) return;
    const trimmed = String(v).trim();
    if (trimmed === "") { updateSavedItems(saved.items.map(x => x.id === it.id ? { ...x, incQty: null } : x)); return; }
    const num = parseInt(trimmed.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(num) || num < 0) { window.alert("กรุณาใส่ตัวเลขจำนวนเต็มที่ถูกต้อง"); return; }
    updateSavedItems(saved.items.map(x => x.id === it.id ? { ...x, incQty: num } : x));
  };
  const editItemNote = (it) => {
    const v = window.prompt(`หมายเหตุสำหรับ "${it.name}"`, it.itemNote || "");
    if (v == null) return;
    updateSavedItems(saved.items.map(x => x.id === it.id ? { ...x, itemNote: v.trim() } : x));
  };
  const deleteItem = (it) => {
    if (!window.confirm(`ลบ "${it.name}" ออกจากบันทึกนี้ใช่ไหม?`)) return;
    updateSavedItems(saved.items.filter(x => x.id !== it.id));
  };
  const toggleSelect = (id) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAll = () => setSelectedIds(prev => (savedShown.length && prev.size === savedShown.length) ? new Set() : new Set(savedShown.map(it => it.id)));
  const deleteSelected = () => {
    if (!selectedIds.size) return;
    if (!window.confirm(`ลบ ${selectedIds.size} รายการที่เลือกออกจากบันทึกนี้ใช่ไหม?`)) return;
    updateSavedItems(saved.items.filter(x => !selectedIds.has(x.id)));
    setSelectedIds(new Set());
  };

  // โน้ตข้อความเดียวฝากถึงฝ่ายอื่น (ไม่ผูกกับรายการสินค้าไหนโดยเฉพาะ) — แก้ไขได้ทันทีไม่ต้องรอ "บันทึก" จากการเทียบข้อมูล
  const openEditNote = () => { setNoteDraft(saved?.note || ""); setEditingNote(true); };
  const saveNote = async () => {
    setSavingNote(true);
    try {
      await api.updateBacklogNote(noteDraft);
      setSaved(prev => ({ ...(prev || {}), note: noteDraft }));
      setEditingNote(false);
      showToast("บันทึกโน้ตแล้ว");
    } catch (e) {
      showToast("บันทึกโน้ตไม่สำเร็จ: " + e.message, "error");
    } finally { setSavingNote(false); }
  };

  const numChip = (v, bg, fg) => v == null
    ? <span style={{ display: "inline-block", borderRadius: 10, padding: "6px 14px", fontWeight: 800, fontSize: 15, fontFamily: "monospace", background: "#F1F5F9", color: "#94A3B8" }}>—</span>
    : <span style={{ display: "inline-block", borderRadius: 10, padding: "6px 14px", fontWeight: 800, fontSize: 15, fontFamily: "monospace", background: bg, color: fg }}>{Number(v).toLocaleString("th-TH")}</span>;

  const tile = (icon, iconBg, value, label, sub) => (
    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: "12px 14px", display: "flex", gap: 10, alignItems: "flex-start", boxShadow: "0 1px 2px rgba(15,23,42,.04)" }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace" }}>{value}</div>
        <div style={{ fontSize: 11, color: "#6B7280" }}>{label}</div>
        {sub && <div style={{ fontSize: 10.5, color: "#9CA3AF", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>}
      </div>
    </div>
  );
  const arrow = (col) => sortCol === col ? (sortDir === "asc" ? " ▲" : " ▼") : "";
  const srcList = (arr) => (arr && arr.length) ? arr.map((x, i) => (
    <div key={i} style={{ fontSize: 10.5, color: "#6B7280", background: "#F8FAF9", borderRadius: 6, padding: "2px 6px", marginBottom: 2 }}>
      {x.name} — {Number(x.qty ?? x.total ?? 0).toLocaleString("th-TH")}
      {x.tag === "guess" && <span style={{ marginLeft: 3, color: "#B45309" }}>(เดา)</span>}
      {x.tag === "manual" && <span style={{ marginLeft: 3, color: "#7C3AED" }}>(ตั้งเอง)</span>}
    </div>
  )) : <span style={{ color: "#D1D5DB", fontSize: 11 }}>—</span>;

  // แท็บย่อยของ "ตารางบันทึก" ด้านล่าง — ของมีแต่ยังไม่ส่ง = มีสต็อก (ไม่ว่าจะพอส่งหรือไม่) · ค้างส่ง = ค้างจาก MyOrder มากกว่าสต็อกที่มี (รวมรายการจับคู่ไม่ได้ทั้งหมดด้วย เพราะไม่มีสต็อกอ้างอิง)
  const savedItemsAll = saved?.items || [];
  const savedOver = useMemo(() => savedItemsAll.filter(it => it.matched && Number(it.stock) > 0), [saved]);
  const savedShort = useMemo(() => savedItemsAll.filter(it => Number(it.myQty) > Number(it.stock || 0)), [saved]);
  const toggleSavedSort = (col) => { if (savedSortCol === col) setSavedSortDir(d => d === "asc" ? "desc" : "asc"); else { setSavedSortCol(col); setSavedSortDir(col === "name" ? "asc" : "desc"); } };
  const savedArrow = (col) => savedSortCol === col ? (savedSortDir === "asc" ? " ▲" : " ▼") : "";
  // อายุสด ณ วันนี้ (ไม่ใช้ it.age ที่ค้างมาจากตอนกด "เทียบข้อมูล" ครั้งล่าสุด) ให้ตรงกับตัวเลขที่แสดงในตารางเป๊ะเวลาเรียงคอลัมน์ "ค้างมา"
  const liveAgeOf = (it) => it.firstSeen == null ? -1 : Math.max(0, Math.floor((new Date(todayStr() + "T00:00:00") - new Date(it.firstSeen + "T00:00:00")) / 86400000));
  const savedShown = useMemo(() => {
    let base = savedFilter === "over" ? savedOver : savedFilter === "short" ? savedShort : savedItemsAll;
    const kw = savedSearch.trim().toLowerCase();
    if (kw) base = base.filter(it => it.name.toLowerCase().includes(kw));
    if (savedSortCol) {
      const dir = savedSortDir === "asc" ? 1 : -1;
      base = [...base].sort((a, b) => savedSortCol === "name"
        ? dir * a.name.localeCompare(b.name, "th")
        : savedSortCol === "age"
        ? ((liveAgeOf(a) - liveAgeOf(b)) * dir || a.name.localeCompare(b.name, "th"))
        : (((Number(a[savedSortCol]) || 0) - (Number(b[savedSortCol]) || 0)) * dir || a.name.localeCompare(b.name, "th")));
    }
    return base;
  }, [saved, savedFilter, savedSearch, savedOver, savedShort, savedSortCol, savedSortDir]);

  return (
    <div>
      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#111827", marginBottom: 4 }}>📋 บันทึกสินค้าค้างส่ง</h2>
        <p style={{ fontSize: 12.5, color: "#6B7280", marginBottom: 10 }}>วางรายการจาก MyOrder (ปุ่ม "คัดลอกรายการสินค้า" ใน extension) แล้วกด "เทียบข้อมูลสินค้า" — ระบบจะบันทึก<b>ทุกรายการที่ค้างส่ง</b> (ทั้งที่ยังมีสต็อกและไม่มีสต็อก) + ที่จับคู่กับคลังไม่ได้ ไว้เป็นโน้ตกันตกหล่น<b>ให้อัตโนมัติทันที</b> พร้อมจำนวนวันที่ค้าง ทุกคนที่เข้าเว็บนี้เห็นบันทึกเดียวกัน</p>
        <textarea value={paste} onChange={e => setPaste(e.target.value)}
          placeholder={"เช่น\nที่เกี่ยวขาแว่นกันหล่น\t480 ชิ้น\nชั้นเสียบครีมติดผนัง\t204 ชิ้น"}
          style={{ width: "100%", minHeight: 130, border: "1px solid #E5E7EB", borderRadius: 10, padding: 10, fontSize: 13, fontFamily: "inherit", resize: "vertical" }} />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          <button onClick={doCompare} disabled={!aliases}
            style={{ background: "#7C3AED", color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: aliases ? "pointer" : "default", opacity: aliases ? 1 : 0.5 }}>
            🔍 เทียบข้อมูลสินค้า
          </button>
          {rows != null && (
            <button onClick={doSave} disabled={saving}
              style={{ background: "#16A34A", color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>
              {saving ? "กำลังบันทึก..." : `💾 บันทึกอีกครั้ง (${rows.length + unmatched.length} รายการ)`}
            </button>
          )}
          <span style={{ fontSize: 12, color: "#6B7280" }}>{parseInfo}</span>
        </div>
      </div>

      {rows != null && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 10 }}>
            {tile("📦", "#F1F5F9", rows.reduce((s, r) => s + r.my, 0).toLocaleString("th-TH") + " ชิ้น", "ค้างส่งจริง (MyOrder)", `${rows.length} สินค้า`)}
            {tile("🏬", "#F1F5F9", rows.reduce((s, r) => s + r.stock, 0).toLocaleString("th-TH") + " ชิ้น", "สต็อกคงเหลือ")}
            {tile("🚚", "#F1F5F9", rows.reduce((s, r) => s + r.inc, 0).toLocaleString("th-TH") + " ชิ้น", "สินค้ารอเข้า")}
            {tile(over.length ? "⚠️" : "✅", over.length ? "#FEE2E2" : "#DCFCE7", over.length, "ของมีแต่ยังไม่ส่ง")}
            {tile("📭", "#F1F5F9", noStock.length, "ค้างส่ง (สต็อกไม่มีของ)")}
            {tile(unmatched.length ? "🔗" : "✅", unmatched.length ? "#FEF3C7" : "#DCFCE7", unmatched.length, "จับคู่ไม่ได้")}
            {oldest && tile("⏳", backlogAgeBg(oldest.age), oldest.age + " วัน", "ค้างนานสุด", `${oldest.p.name} — สั่ง ${oldest.firstSeen}${oldest.dateIsReal ? "" : " (ประมาณ)"}`)}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 4, background: "#EAEFED", borderRadius: 12, padding: 4 }}>
              {[["over", `🔴 ของมีแต่ยังไม่ส่ง (${over.length})`], ["noStock", `📭 ค้างส่ง (สต็อกไม่มีของ) (${noStock.length})`], ["all", `ทั้งหมด (${rows.length})`]].map(([v, l]) => (
                <button key={v} onClick={() => setFilterMode(v)}
                  style={{ background: filterMode === v ? "#7C3AED" : "transparent", color: filterMode === v ? "#fff" : "#6B7280", border: "none", borderRadius: 9, padding: "8px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{l}</button>
              ))}
            </div>
            <button onClick={clearAllAge} style={{ marginLeft: "auto", background: "transparent", border: "1px solid #E5E7EB", color: "#6B7280", borderRadius: 10, padding: "8px 12px", fontSize: 11.5, cursor: "pointer" }}>🗑️ ล้างประวัติ "ค้างมา" ทั้งหมด</button>
          </div>

          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, overflow: "hidden", overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  {[["name", "ชื่อสินค้า"], ["my", "ค้างส่งจาก MyOrder"], ["stock", "สต็อกคงเหลือ"], ["inc", "สินค้ารอเข้า"], ["age", "ค้างมา (วัน)"]].map(([col, label]) => (
                    <th key={col} onClick={() => toggleSort(col)} style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>{label}{arrow(col)}</th>
                  ))}
                  <th>ที่มาฝั่ง MyOrder</th><th>ที่มารอเข้า</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", padding: 24, color: "#9CA3AF" }}>{rows.length ? "✅ ไม่มีรายการในกลุ่มนี้" : "ไม่มีสินค้าที่จับคู่ได้เลย"}</td></tr>}
                {shown.map(r => (
                  <tr key={r.p.id} style={{ background: r.over ? "#FFF6F6" : undefined }}>
                    <td style={{ borderLeft: r.over ? "3px solid #DC2626" : "3px solid transparent" }}>
                      <b>{r.p.name}</b><br /><span style={{ fontFamily: "monospace", color: "#9CA3AF", fontSize: 11 }}>{r.p.sku}</span>
                    </td>
                    <td style={{ fontFamily: "monospace" }}>{r.my.toLocaleString("th-TH")}</td>
                    <td style={{ fontFamily: "monospace", color: r.over ? "#DC2626" : undefined, fontWeight: r.over ? 700 : 400 }}>{r.stock.toLocaleString("th-TH")}</td>
                    <td style={{ fontFamily: "monospace" }}>{r.inc ? r.inc.toLocaleString("th-TH") : "—"}</td>
                    <td title={`สั่งซื้อวันที่ ${r.firstSeen}${r.dateIsReal ? " (วันที่สั่งซื้อจริง)" : " (ประมาณจากวันที่สแกน)"}`}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: backlogAgeBg(r.age), color: backlogAgeTone(r.age), borderRadius: 99, padding: "3px 9px", fontWeight: 800, fontSize: 12, fontFamily: "monospace" }}>
                        {r.age} วัน{r.dateIsReal ? " 📅" : ""}
                      </span>
                      {r.age > 0 && <button onClick={() => resetAge(r.p.id)} title="เริ่มนับใหม่ตั้งแต่วันนี้" style={{ marginLeft: 4, padding: "1px 6px", fontSize: 10, background: "#F3F4F6", border: "none", borderRadius: 6, cursor: "pointer" }}>↺</button>}
                    </td>
                    <td>{srcList(r.mySrc)}</td>
                    <td>{srcList(r.incSrc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {unmatched.length > 0 && (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: 16, marginTop: 14 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>❓ ชื่อจาก MyOrder ที่จับคู่กับสินค้าในคลังไม่ได้ ({unmatched.length}) — ยอดพวกนี้ไม่รวมในตารางด้านบน</h3>
              <table>
                <thead><tr><th>ชื่อใน MyOrder</th><th>ชิ้น</th><th>สาเหตุ</th><th>จับคู่เอง</th></tr></thead>
                <tbody>
                  {unmatched.map((u, i) => (
                    <tr key={i}>
                      <td>{u.name}</td><td style={{ fontFamily: "monospace" }}>{u.qty}</td><td style={{ fontSize: 11.5, color: "#9CA3AF" }}>{u.how}</td>
                      <td>
                        <ProductPicker products={products}
                          value={Object.prototype.hasOwnProperty.call(manual, u.name) ? (manual[u.name] == null ? "none" : String(manual[u.name])) : "auto"}
                          autoLabel="— เลือกสินค้าในคลัง —" onPick={v => setManualMatch(u.name, v)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {Object.keys(manual).length > 0 && (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: 16, marginTop: 14 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>🔧 การจับคู่ที่ตั้งเองในเครื่องนี้ ({Object.keys(manual).length})</h3>
              {Object.entries(manual).map(([k, v]) => (
                <div key={k} style={{ fontSize: 12, color: "#6B7280", margin: "3px 0" }}>
                  {k} → <b>{v == null ? "ไม่จับคู่ / ไม่มีในคลัง" : (byId.get(String(v))?.name || "(ถูกลบ)")}</b>
                  <button onClick={() => setManualMatch(k, "auto")} style={{ marginLeft: 8, padding: "2px 8px", fontSize: 11, background: "#F3F4F6", border: "none", borderRadius: 6, cursor: "pointer" }}>ยกเลิก</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {saved === undefined ? (
        <div style={{ textAlign: "center", padding: 30, color: "#9CA3AF", fontSize: 13 }}>⏳ กำลังโหลดบันทึก...</div>
      ) : (
        <>
          <div style={{ background: "linear-gradient(135deg,#4F46E5,#9333EA)", borderRadius: 20, padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginBottom: 16, boxShadow: "0 8px 24px rgba(79,70,229,.25)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 52, height: 52, borderRadius: 16, background: "rgba(255,255,255,.22)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>📋📦</div>
              <div>
                <div style={{ color: "#fff", fontSize: 20, fontWeight: 800 }}>บันทึกสินค้าค้างส่ง</div>
                <div style={{ color: "rgba(255,255,255,.85)", fontSize: 12, marginTop: 2 }}>แก้ไข/ลบรายการได้ — ทุกคนเห็นบันทึกเดียวกัน</div>
              </div>
            </div>
            {saved?.saved_at && (
              <div style={{ background: "#FDE68A", borderRadius: 14, padding: "8px 16px", textAlign: "center" }}>
                <div style={{ color: "#92400E", fontSize: 11, fontWeight: 800 }}>📅 บันทึกล่าสุด</div>
                <div style={{ background: "#fff", borderRadius: 10, padding: "4px 12px", marginTop: 4, fontWeight: 800, color: "#111827", fontSize: 13, whiteSpace: "nowrap" }}>{fmtDT(saved.saved_at)}</div>
              </div>
            )}
          </div>

          {/* ── โน้ตข้อความเดียวฝากถึงฝ่ายอื่น อยู่บนสุด ไม่ผูกกับรายการไหน ── */}
          {!editingNote ? (
            <div style={{ background: saved?.note ? "#FFFBEB" : "#F8FAF9", border: saved?.note ? "1.5px solid #FDE68A" : "1px dashed #D1D5DB", borderRadius: 14, padding: "12px 16px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: saved?.note ? "#92400E" : "#9CA3AF", marginBottom: 4 }}>📌 โน้ตถึงฝ่ายอื่น</div>
                {saved?.note
                  ? <div className="backlog-note-cols" style={{ fontSize: 13, color: "#78350F" }}>{saved.note.split(/\r?\n/).map((line, i) => <div key={i}>{line || " "}</div>)}</div>
                  : <div style={{ fontSize: 12.5, color: "#9CA3AF" }}>ยังไม่มีโน้ต — กด "แก้ไข" เพื่อฝากข้อความถึงฝ่ายอื่น</div>}
              </div>
              <button onClick={openEditNote} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 9, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>✏️ แก้ไข</button>
            </div>
          ) : (
            <div style={{ background: "#FFFBEB", border: "1.5px solid #FDE68A", borderRadius: 14, padding: "12px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#92400E", marginBottom: 6 }}>📌 โน้ตถึงฝ่ายอื่น</div>
              <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} rows={3} autoFocus
                placeholder="พิมพ์ข้อความฝากไว้ให้ฝ่ายอื่นอ่าน..."
                style={{ width: "100%", border: "1px solid #FDE68A", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={saveNote} disabled={savingNote} style={{ background: "#7C3AED", color: "#fff", border: "none", borderRadius: 9, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: savingNote ? "default" : "pointer", opacity: savingNote ? 0.6 : 1 }}>{savingNote ? "กำลังบันทึก..." : "บันทึกโน้ต"}</button>
                <button onClick={() => setEditingNote(false)} style={{ background: "#F3F4F6", border: "none", borderRadius: 9, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>ยกเลิก</button>
              </div>
            </div>
          )}

          {!saved || !Array.isArray(saved.items) || saved.items.length === 0 ? (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, textAlign: "center", padding: 32, color: "#9CA3AF", fontSize: 13 }}>
              ยังไม่มีบันทึกรายการ — วางข้อมูลด้านบนแล้วกด "เทียบข้อมูลสินค้า" ระบบจะบันทึกให้อัตโนมัติ
            </div>
          ) : (
          <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 4, background: "#EAEFED", borderRadius: 12, padding: 4 }}>
              {[["all", `ทั้งหมด (${savedItemsAll.length})`], ["over", `🔴 ของมีแต่ยังไม่ส่ง (${savedOver.length})`], ["short", `📭 ค้างส่ง (${savedShort.length})`]].map(([v, l]) => (
                <button key={v} onClick={() => setSavedFilter(v)}
                  style={{ background: savedFilter === v ? "#7C3AED" : "transparent", color: savedFilter === v ? "#fff" : "#6B7280", border: "none", borderRadius: 9, padding: "8px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{l}</button>
              ))}
            </div>
            <input className="inp" value={savedSearch} onChange={e => setSavedSearch(e.target.value)} placeholder="🔍 กรองชื่อสินค้า..." style={{ maxWidth: 220, padding: "8px 12px" }} />
          </div>
          {selectedIds.size > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 12, padding: "8px 14px", marginBottom: 10 }}>
              <span style={{ fontSize: 12.5, color: "#991B1B", fontWeight: 700 }}>เลือกแล้ว {selectedIds.size} รายการ</span>
              <button onClick={deleteSelected} style={{ background: "#DC2626", color: "#fff", border: "none", borderRadius: 9, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>🗑️ ลบที่เลือก</button>
              <button onClick={() => setSelectedIds(new Set())} style={{ background: "transparent", border: "none", color: "#991B1B", fontSize: 12.5, cursor: "pointer" }}>ยกเลิก</button>
            </div>
          )}
          <div style={{ borderRadius: 18, overflow: "hidden", boxShadow: "0 1px 2px rgba(15,23,42,.04), 0 8px 20px rgba(15,23,42,.05)", border: "1px solid #E5E7EB", background: "#fff", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 6px", padding: "0 10px 10px" }}>
              <thead>
                <tr>
                  {[["", null], ["ลำดับ", null], ["📦 ชื่อสินค้า", "name"], ["✅ ค้างส่งจาก MyOrder", "myQty"], ["📦 สต็อกคงเหลือ", "stock"], ["🚚 สินค้ารอเข้า", "incQty"], ["⏳ ค้างมา (วัน)", "age"], ["📝 หมายเหตุ", null], ["จัดการ", null]].map(([h, col], i) => (
                    <th key={i} onClick={col ? () => toggleSavedSort(col) : undefined} style={{
                      padding: "12px 10px", fontSize: 12, fontWeight: 800, color: "#fff", textAlign: i === 2 || i === 7 ? "left" : "center",
                      background: ["#3B82F6", "#3B82F6", "#3B82F6", "#F43F5E", "#F59E0B", "#10B981", "#EA580C", "#8B5CF6", "#64748B"][i],
                      borderRadius: i === 0 ? "12px 0 0 12px" : i === 8 ? "0 12px 12px 0" : 0,
                      cursor: col ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap",
                    }}>{i === 0 ? <input type="checkbox" checked={savedShown.length > 0 && selectedIds.size === savedShown.length} onChange={toggleSelectAll} style={{ cursor: "pointer" }} /> : <>{h}{col ? savedArrow(col) : ""}</>}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {savedShown.length === 0 && (
                  <tr><td colSpan={9} style={{ textAlign: "center", padding: 24, color: "#9CA3AF", background: "#FAFBFC" }}>ไม่มีรายการในกลุ่มนี้</td></tr>
                )}
                {savedShown.map((it, i) => (
                  <tr key={it.id} style={{ background: selectedIds.has(it.id) ? "#FEF2F2" : undefined }}>
                    <td style={{ padding: 10, textAlign: "center", background: selectedIds.has(it.id) ? "#FEF2F2" : "#FAFBFC", borderRadius: "12px 0 0 12px" }}>
                      <input type="checkbox" checked={selectedIds.has(it.id)} onChange={() => toggleSelect(it.id)} style={{ cursor: "pointer" }} />
                    </td>
                    <td style={{ padding: 10, textAlign: "center", background: selectedIds.has(it.id) ? "#FEF2F2" : "#FAFBFC" }}>
                      <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#3B82F6", color: "#fff", fontWeight: 800, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto" }}>{i + 1}</div>
                    </td>
                    <td style={{ padding: 10, background: selectedIds.has(it.id) ? "#FEF2F2" : "#FAFBFC", textAlign: "left" }}>
                      <b style={{ fontSize: 13.5 }}>{it.name}</b>
                      {it.matched
                        ? <span style={{ display: "block", fontFamily: "monospace", color: "#6B7280", fontSize: 11.5 }}>{it.sku || ""}</span>
                        : <span style={{ display: "inline-block", marginTop: 2, fontSize: 10.5, padding: "2px 8px", borderRadius: 99, background: "#FFFBEB", color: "#B45309", fontWeight: 700 }}>ไม่พบใน StockMaster</span>}
                    </td>
                    <td style={{ padding: 10, textAlign: "center", background: selectedIds.has(it.id) ? "#FEF2F2" : "#FAFBFC" }}>{numChip(it.myQty, "#FEE2E2", "#DC2626")}</td>
                    <td style={{ padding: 10, textAlign: "center", background: selectedIds.has(it.id) ? "#FEF2F2" : "#FAFBFC" }}>{numChip(it.stock, "#FEF3C7", "#B45309")}</td>
                    <td style={{ padding: 10, textAlign: "center", background: selectedIds.has(it.id) ? "#FEF2F2" : "#FAFBFC" }}>
                      {it.matched ? numChip(it.incQty, "#D1FAE5", "#047857") : (
                        <button onClick={() => editIncQty(it)} title="กรอกจำนวนรอเข้าเอง (ไม่มี SKU ให้ดึงยอดจริงอัตโนมัติ)"
                          style={{ display: "inline-block", borderRadius: 10, padding: "6px 14px", fontWeight: 800, fontSize: 15, fontFamily: "monospace", cursor: "pointer", background: it.incQty != null ? "#D1FAE5" : "#F1F5F9", color: it.incQty != null ? "#047857" : "#94A3B8", border: "1.5px dashed " + (it.incQty != null ? "#6EE7B7" : "#CBD5E1") }}>
                          {it.incQty != null ? Number(it.incQty).toLocaleString("th-TH") : "+ กรอก"}
                        </button>
                      )}
                    </td>
                    <td style={{ padding: 10, textAlign: "center", background: selectedIds.has(it.id) ? "#FEF2F2" : "#FAFBFC" }}>
                      {it.firstSeen == null ? <span style={{ color: "#9CA3AF", fontSize: 11.5 }}>— (บันทึกก่อนหน้า)</span> : (
                        <span title={`สั่งซื้อวันที่ ${it.firstSeen}${it.dateIsReal ? " (วันที่สั่งซื้อจริง)" : " (ประมาณจากวันที่สแกน)"}`}
                          style={{ display: "inline-flex", alignItems: "center", gap: 3, background: backlogAgeBg(liveAgeOf(it)), color: backlogAgeTone(liveAgeOf(it)), borderRadius: 99, padding: "3px 9px", fontWeight: 800, fontSize: 12, fontFamily: "monospace" }}>
                          {liveAgeOf(it)} วัน{it.dateIsReal ? " 📅" : ""}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: 10, textAlign: "left", background: selectedIds.has(it.id) ? "#FEF2F2" : "#FAFBFC", fontSize: 12, color: "#111827", maxWidth: 160 }}>
                      {it.itemNote ? it.itemNote : <span style={{ color: "#9CA3AF" }}>—</span>}
                    </td>
                    <td style={{ padding: 10, textAlign: "center", background: selectedIds.has(it.id) ? "#FEF2F2" : "#FAFBFC", borderRadius: "0 12px 12px 0" }}>
                      <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                        {it.matched && onViewHistory && (
                          <button onClick={() => onViewHistory(byId.get(String(it.id)))} title="ดูรายการเคลื่อนไหว" style={{ padding: "6px 8px", fontSize: 13, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 8, cursor: "pointer" }}>🕘</button>
                        )}
                        <button onClick={() => editQty(it)} title="แก้ไขจำนวนค้างส่ง" style={{ padding: "6px 8px", fontSize: 13, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 8, cursor: "pointer" }}>✏️</button>
                        <button onClick={() => editItemNote(it)} title="แก้ไขหมายเหตุ" style={{ padding: "6px 8px", fontSize: 13, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 8, cursor: "pointer" }}>📝</button>
                        <button onClick={() => deleteItem(it)} title="ลบรายการนี้" style={{ padding: "6px 8px", fontSize: 13, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 8, cursor: "pointer" }}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 14, background: "#DBEAFE", borderRadius: 14, padding: "12px 18px", textAlign: "center", fontSize: 12, color: "#1E3A8A", fontWeight: 700 }}>
            🔄 บันทึกนี้อัปเดตอัตโนมัติทุกครั้งที่กด "เทียบข้อมูลสินค้า" ด้านบนสำเร็จ (หมายเหตุ/จำนวนรอเข้าที่กรอกเองไว้จะไม่หายไป)
          </div>
          </>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════ พิมพ์แผ่นบาร์โค้ด SKU (รูปใหญ่ + ชื่อ + Code128) ไว้ติดที่ช่องเก็บสินค้า ═══════════
function LabelSheetPanel({ products }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(new Set());
  const [layout, setLayout] = useState("a4-21"); // ค่าเริ่มต้น = ชื่อ + บาร์โค้ด ไม่มีรูป (สินค้าส่วนใหญ่ยังไม่มีรูป)
  const [copies, setCopies] = useState(1);
  const kw = q.trim().toLowerCase();
  const list = useMemo(() => products.filter(p => !kw || p.name.toLowerCase().includes(kw) || String(p.sku || "").toLowerCase().includes(kw) || String(p.location || "").toLowerCase().includes(kw)), [products, kw]);
  const toggle = (id) => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectFiltered = () => setSel(prev => { const n = new Set(prev); list.forEach(p => n.add(p.id)); return n; });
  const selected = products.filter(p => sel.has(p.id));
  const missingImage = selected.filter(p => !p.imageUrl); // บังคับให้ทุกสินค้าที่จะพิมพ์ต้องมีรูปก่อนเสมอ ไม่ว่าจะเลือกเลย์เอาต์ไหน (เลย์เอาต์ a4-21 เองก็ไม่โชว์รูปบนใบ แต่ยังบังคับต้องมีรูปในระบบก่อนพิมพ์ได้)

  const print = () => {
    if (selected.length === 0) return;
    if (missingImage.length > 0) { alert(`มีสินค้า ${missingImage.length} รายการยังไม่มีรูป กรุณาเพิ่มรูปก่อนพิมพ์:\n${missingImage.slice(0, 15).map(p => "• " + p.name).join("\n")}${missingImage.length > 15 ? `\n...และอีก ${missingImage.length - 15} รายการ` : ""}\n\nไปที่หน้า "คลังสินค้า" แล้วคลิกที่รูปสินค้าเพื่ออัปโหลด`); return; }
    const roll = layout === "roll32x25"; // ม้วนสติกเกอร์ต่อเนื่องจากเครื่องพิมพ์บาร์โค้ดความร้อน (Xprinter/TSC) — 1 หน้า = 1 ดวงพอดี ไม่ใช่กระดาษ A4
    const page = roll ? "@page { size: 32mm 25mm; margin: 1mm; }" : layout === "s100" ? "@page { size: 100mm 150mm; margin: 4mm; }" : "@page { size: A4; margin: 8mm; }";
    const compact = layout === "a4-21"; // ชื่อ + บาร์โค้ด อย่างเดียว 3 คอลัมน์ × 7 แถว
    const grid = roll ? "grid-template-columns: 1fr; grid-auto-rows: 23mm; gap: 0;" : compact ? "grid-template-columns: repeat(3, 1fr); grid-auto-rows: 38mm;" : layout === "a4-8" ? "grid-template-columns: repeat(2, 1fr); grid-auto-rows: 68mm;" : layout === "a4-4" ? "grid-template-columns: repeat(2, 1fr); grid-auto-rows: 138mm;" : "grid-template-columns: 1fr; grid-auto-rows: 140mm;";
    const imgH = layout === "a4-8" ? "34mm" : layout === "a4-4" ? "85mm" : "82mm";
    const nameSize = roll ? "8pt" : compact ? "9.5pt" : layout === "a4-8" ? "11pt" : "15pt";
    const labels = [];
    selected.forEach(p => { for (let i = 0; i < Math.max(1, copies); i++) labels.push(p); });
    const cells = labels.map(p => `
      <div class="label">
        ${(compact || roll) ? "" : `<div class="img">${p.imageUrl ? `<img src="${escHtml(p.imageUrl)}" alt="">` : `<div class="noimg">📦<br><span>ไม่มีรูป</span></div>`}</div>`}
        <div class="name">${escHtml(p.name)}</div>
        ${roll
          ? (p.location && p.location !== "-" ? `<div class="meta">ช่อง ${escHtml(p.location)}</div>` : "")
          : `<div class="meta">${p.location && p.location !== "-" ? "ช่อง " + escHtml(p.location) + " · " : ""}${escHtml(p.unit || "ชิ้น")}</div>`}
        <div class="bc">${code128Svg(String(p.sku), { height: roll ? 22 : compact ? 34 : 40, module: 2, fontSize: roll ? 9 : 13 })}</div>
      </div>`).join("");
    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>แผ่นบาร์โค้ด ${labels.length} ใบ</title>
<style>
  ${page}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Sarabun', 'Tahoma', sans-serif; color: #000; background: #fff; color-scheme: light; }
  .grid { display: grid; ${grid} gap: 3mm; }
  .label { border: 0.4mm dashed #999; border-radius: 2mm; padding: 2.5mm; display: flex; flex-direction: column; align-items: center; text-align: center; page-break-inside: avoid; break-inside: avoid; overflow: hidden; }
  .img { height: ${imgH}; width: 100%; display: flex; align-items: center; justify-content: center; }
  .img img { max-height: 100%; max-width: 100%; object-fit: contain; }
  .noimg { color: #999; font-size: 22pt; line-height: 1.1; } .noimg span { font-size: 8pt; }
  .name { font-size: ${nameSize}; font-weight: 700; line-height: 1.25; margin-top: 1.5mm; }
  .meta { font-size: 8.5pt; color: #444; margin-top: 0.5mm; }
  .bc { margin-top: 1.5mm; width: 100%; display: flex; justify-content: center; }
  .bc svg { width: ${roll ? "28mm" : compact ? "52mm" : layout === "a4-8" ? "58mm" : "70mm"}; height: auto; }
  ${compact ? ".label { padding: 2mm 1.5mm; justify-content: center; } .name { margin-top: 0; min-height: 2.5em; display: flex; align-items: center; } .meta { font-size: 7.5pt; }" : ""}
  ${roll ? ".label { border: none; padding: 0.5mm; justify-content: center; page-break-after: always; break-after: page; } .label:last-child { page-break-after: auto; break-after: auto; } .name { margin-top: 0; font-size: 8pt; } .meta { font-size: 6.5pt; margin-top: 0.3mm; }" : ""}
  @media print { .label { border-color: #bbb; } }
</style></head><body><div class="grid">${cells}</div>
</body></html>`;
    printHtmlInPlace(html);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 4 }}>🏷️ พิมพ์แผ่นบาร์โค้ด SKU</h2>
          <p style={{ fontSize: 13, color: "#6B7280" }}>เลือกสินค้า → พิมพ์แผ่นที่มีรูปใหญ่ + ชื่อ + บาร์โค้ด Code128 ของ SKU เอาไปติด<b>ที่ช่องเก็บ</b> (ไม่ใช่วางลอยๆ) เวลาเติมของต้องเช็คว่าแผ่นตรงกับของที่เติมทุกครั้ง</p>
        </div>
      </div>
      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: 14, marginBottom: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input className="inp" value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 ค้นหาชื่อ / SKU / ช่องเก็บ..." style={{ flex: 1, minWidth: 220 }} />
        <select className="inp" value={layout} onChange={e => setLayout(e.target.value)} style={{ width: 230 }}>
          <option value="a4-21">A4 — 21 แผ่น/หน้า (ชื่อ + บาร์โค้ด ไม่มีรูป)</option>
          <option value="a4-8">A4 — 8 แผ่น/หน้า (รูปกลาง)</option>
          <option value="a4-4">A4 — 4 แผ่น/หน้า (รูปใหญ่)</option>
          <option value="s100">สติกเกอร์ 100×150 มม. — 1 แผ่น/ใบ</option>
          <option value="roll32x25">ม้วนต่อเนื่อง 32×25 มม. (Xprinter/TSC) — 1 บาร์โค้ด/ดวง</option>
        </select>
        <label style={{ fontSize: 12, color: "#6B7280", display: "flex", alignItems: "center", gap: 6 }}>สำเนา
          <input className="inp" type="number" min={1} max={10} value={copies} onChange={e => setCopies(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))} style={{ width: 64, padding: "7px 8px" }} />
        </label>
        <button onClick={selectFiltered} style={{ background: "#F3F4F6", color: "#374151", border: "none", borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>เลือกทั้งหมดที่แสดง ({list.length})</button>
        <button onClick={() => setSel(new Set())} disabled={sel.size === 0} style={{ background: "#F3F4F6", color: "#6B7280", border: "none", borderRadius: 10, padding: "9px 12px", fontSize: 13, cursor: "pointer", opacity: sel.size === 0 ? 0.5 : 1 }}>ล้าง</button>
        <button onClick={print} disabled={sel.size === 0 || missingImage.length > 0}
          title={missingImage.length > 0 ? `มี ${missingImage.length} รายการยังไม่มีรูป — เพิ่มรูปให้ครบก่อนถึงจะพิมพ์ได้` : undefined}
          style={{ background: sel.size && missingImage.length === 0 ? "linear-gradient(135deg,#7C3AED,#3B82F6)" : "#E5E7EB", color: "#fff", border: "none", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: sel.size && missingImage.length === 0 ? "pointer" : "not-allowed" }}>🖨️ พิมพ์ {sel.size ? `${sel.size} รายการ` : ""}</button>
      </div>
      {missingImage.length > 0 && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 14, padding: "12px 16px", marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <div style={{ fontSize: 13, color: "#991B1B" }}>
            <b>สินค้าที่เลือกยังไม่มีรูป {missingImage.length} รายการ</b> — ต้องเพิ่มรูปให้ครบก่อนถึงจะพิมพ์ได้ (ไปที่หน้า "คลังสินค้า" คลิกที่รูปสินค้าเพื่ออัปโหลด) รายการที่ไม่มีรูปไฮไลท์สีแดงไว้ด้านล่าง
          </div>
        </div>
      )}
      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, overflow: "hidden", overflowX: "auto" }}>
        <table>
          <thead><tr>
            <th style={{ width: 40 }}>
              <input type="checkbox" checked={list.length > 0 && list.every(p => sel.has(p.id))}
                onChange={() => setSel(prev => {
                  const allSelected = list.length > 0 && list.every(p => sel.has(p.id));
                  const n = new Set(prev);
                  list.forEach(p => allSelected ? n.delete(p.id) : n.add(p.id));
                  return n;
                })}
                style={{ cursor: "pointer" }} title="เลือก/ยกเลิกเลือกทั้งหมดที่แสดง" />
            </th>
            <th>รูป</th><th>SKU</th><th>ชื่อสินค้า</th><th>ช่องเก็บ</th><th>คงเหลือ</th><th>ตัวอย่างบาร์โค้ด</th></tr></thead>
          <tbody>
            {list.map(p => {
              const flagMissing = sel.has(p.id) && !p.imageUrl;
              return (
              <tr key={p.id} onClick={() => toggle(p.id)} style={{ cursor: "pointer", background: flagMissing ? "#FEF2F2" : sel.has(p.id) ? "#F5F3FF" : undefined }}>
                <td><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} onClick={e => e.stopPropagation()} /></td>
                <td>{p.imageUrl ? <img src={p.imageUrl} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid #E5E7EB" }} /> : <span style={{ color: flagMissing ? "#DC2626" : "#D1D5DB", fontWeight: flagMissing ? 700 : 400 }}>{flagMissing ? "⚠️ ไม่มีรูป" : "—"}</span>}</td>
                <td style={{ fontFamily: "monospace" }}>{p.sku}</td>
                <td style={{ fontWeight: 600 }}>{p.name}</td>
                <td>{p.location}</td>
                <td style={{ fontFamily: "monospace" }}>{p.quantity}</td>
                <td><div style={{ width: 130 }} dangerouslySetInnerHTML={{ __html: code128Svg(String(p.sku), { height: 22, module: 1, fontSize: 9 }).replace("<svg ", '<svg style="width:100%;height:auto" ') }} /></td>
              </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && <div style={{ textAlign: "center", padding: 32, color: "#9CA3AF", fontSize: 13 }}>ไม่พบสินค้า</div>}
      </div>
    </div>
  );
}

// ═══════════ รับสินค้าเข้า (แทนใบพิมพ์กระดาษ) — ฝ่ายคลังบันทึกที่นี่ ไม่ล็อกรหัส ═══════════
// บันทึกแล้วเป็นแค่ "pending" ไม่กระทบสต็อกทันที — ผู้จัดการต้องมาอนุมัติในหน้าเช็คสต็อกก่อนถึงจะเข้าสต็อกจริง
// รายการรอรับทำงานต่อ "ใบสั่งซื้อ" (n2p_orders) แต่ละใบ ไม่ใช่รวมยอดเป็นก้อนเดียวต่อสินค้า —
// เพราะสินค้าตัวเดียวอาจมาจากหลายใบสั่งซื้อพร้อมกัน (คนละรอบสั่ง) ต้องรู้ว่าของที่รับมาตรงกับใบไหน
// เหมือนใบพิมพ์กระดาษเดิมที่พิมพ์แยกทีละใบ (ดูภาพหน้าใบสั่งสินค้าจริงที่ผู้ใช้ส่งมาเป็นต้นแบบ)
function ReceivingPanel({ products, backlog, incomingAlias, onReceivingLogChange, showToast }) {
  const [orders, setOrders] = useState([]);
  const [receivingLogsAll, setReceivingLogsAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openDocId, setOpenDocId] = useState(null);
  const [formItems, setFormItems] = useState({}); // { [roundKey]: {receivedQty, note, productId} }
  const [by, setBy] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [ords, logs] = await Promise.all([api.getOrders(), api.getReceivingLogs()]);
      setOrders(ords || []);
      setReceivingLogsAll(logs || []);
    } catch { /* เงียบไว้ — ไม่ให้บล็อกหน้าถ้าตารางยังไม่ถูกสร้าง */ }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // เริ่มจาก "รอบสั่ง" ที่ยังรับไม่ครบใน n2p_backlog เอง (แหล่งเดียวกับคอลัมน์ "รอเข้า" ในหน้าคลังที่ใช้อยู่แล้ว) แล้วค่อยไล่หาว่ามาจากใบสั่งซื้อใบไหน
  // ไม่ไล่จากประวัติใบสั่งซื้อทั้งหมดตรงๆ เพราะใบเก่าจำนวนมาก (800+ ใบ) ไม่เคยอัปเดตสถานะรับเข้าในระบบใบสั่งเลย (เดิมรับด้วยกระดาษ ไม่เคยกดที่นั่น)
  // ถ้าไล่จากใบสั่งจะเจอใบเก่าโผล่มาเป็นร้อยทั้งที่รับไปนานแล้ว — ต้องยึด n2p_backlog.rounds เป็นความจริงเสมอ
  const pendingDocs = useMemo(() => {
    const roundToDocItem = new Map(); // "backlogItemId:backlogRoundId" -> { doc, item }
    orders.forEach(o => {
      const d = o.data || {};
      (d.items || []).forEach(it => {
        if (it.backlogItemId != null && it.backlogRoundId != null) {
          roundToDocItem.set(`${it.backlogItemId}:${it.backlogRoundId}`, { d, doc_no: o.doc_no, it });
        }
      });
    });
    // นับเฉพาะ status='pending' — 'approved' ถูกเขียนกลับเข้า receivedQty ของ n2p_backlog จริงแล้ว (syncApprovalToOrderSystem) นับซ้ำที่นี่จะหักเกิน
    const loggedByKey = new Map();
    receivingLogsAll.filter(r => r.status === "pending").forEach(r => {
      const key = r.backlog_round_id != null ? `r:${r.backlog_round_id}` : `k:${r.doc_id}:${r.backlog_item_name}`;
      loggedByKey.set(key, (loggedByKey.get(key) || 0) + (Number(r.received_qty) || 0));
    });

    const docsMap = new Map();
    (backlog || []).forEach(b => {
      (b.rounds || []).forEach(r => {
        if (r.___meta) return;
        const orderedQty = Number(r.qty) || 0;
        const alreadyInBacklog = Number(r.receivedQty) || 0;
        const roundKey = `r:${r.id}`;
        const alreadyLogged = loggedByKey.get(roundKey) || 0;
        const pendingQty = Math.max(0, orderedQty - alreadyInBacklog - alreadyLogged);
        if (pendingQty <= 0) return;
        const match = roundToDocItem.get(`${b.id}:${r.id}`);
        const docKey = match ? String(match.d.docNo || match.doc_no) + ":" + String(match.d.id || "") : `orphan:${b.id}:${r.id}`;
        if (!docsMap.has(docKey)) {
          docsMap.set(docKey, {
            docKey, docId: match ? match.d.id : null, docNo: match ? (match.d.docNo || match.doc_no) : null,
            orderDate: match ? match.d.orderDate : r.date, needDate: match ? match.d.needDate : null,
            orderedBy: match ? match.d.orderedBy : r.orderedBy, supplier: match ? match.d.supplier : r.orderNo,
            channel: match ? match.d.channel : r.tracking, orderNote: match ? match.d.orderNote : r.note,
            items: [],
          });
        }
        const itemName = match ? match.it.name : b.name;
        const unit = match ? match.it.unit : "ชิ้น";
        const m = matchBacklogName(String(itemName).trim(), products, incomingAlias);
        docsMap.get(docKey).items.push({ roundKey, name: itemName, unit, backlogItemId: b.id, backlogRoundId: r.id, orderedQty, pendingQty, ...m });
      });
    });
    return [...docsMap.values()].sort((a, b) => String(a.orderDate || "").localeCompare(String(b.orderDate || "")));
  }, [orders, backlog, products, incomingAlias, receivingLogsAll]);

  const kw = search.trim().toLowerCase();
  const shownDocs = kw ? pendingDocs.filter(d => (d.docNo || "").toLowerCase().includes(kw) || d.items.some(it => it.name.toLowerCase().includes(kw))) : pendingDocs;
  const openDoc = pendingDocs.find(d => d.docKey === openDocId) || null;
  const myPending = receivingLogsAll.filter(r => r.status === "pending");

  const openDocFor = (doc) => {
    setOpenDocId(doc.docKey);
    const init = {};
    doc.items.forEach(it => { init[it.roundKey] = { receivedQty: it.pendingQty, note: "", productId: it.productId }; });
    setFormItems(init);
  };
  const updateItem = (roundKey, patch) => setFormItems(prev => ({ ...prev, [roundKey]: { ...prev[roundKey], ...patch } }));
  const dateLabel = (iso) => iso ? new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "-";

  const submit = async () => {
    if (!openDoc) return;
    const valid = openDoc.items.filter(it => it.pendingQty > 0 && Number(formItems[it.roundKey]?.receivedQty) > 0);
    if (valid.length === 0) return showToast("กรุณาระบุจำนวนที่รับอย่างน้อย 1 รายการ", "error");
    if (!by.trim()) return showToast("กรุณากรอกชื่อผู้รับสินค้า", "error");
    setSaving(true);
    try {
      const payload = valid.map(it => {
        const f = formItems[it.roundKey];
        const p = f.productId ? products.find(x => String(x.id) === String(f.productId)) : null;
        return {
          doc_id: openDoc.docId, doc_no: openDoc.docNo,
          backlog_item_id: it.backlogItemId, backlog_round_id: it.backlogRoundId, backlog_item_name: it.name,
          product_id: p ? p.id : null, product_name: p ? p.name : null, sku: p ? p.sku : null,
          ordered_qty: it.pendingQty, received_qty: Number(f.receivedQty) || 0,
          note: f.note || null, received_by: by.trim(), status: "pending",
        };
      });
      const created = await api.addReceivingLogs(payload);
      if (onReceivingLogChange && created) onReceivingLogChange(created);
      showToast(`บันทึกรับเข้า ${valid.length} รายการ${openDoc.docNo ? `จากใบสั่งซื้อ ${openDoc.docNo}` : ""} แล้ว — รอผู้จัดการอนุมัติ`);
      setOpenDocId(null);
      setFormItems({});
      load();
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#6B7280" }}>กำลังโหลด...</div>;

  if (openDoc) {
    return (
      <div>
        <button onClick={() => { setOpenDocId(null); setFormItems({}); }}
          style={{ background: "none", border: "none", color: "#7C3AED", fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 12, padding: 0 }}>
          ← กลับไปรายการใบสั่งซื้อ
        </button>
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: "#9CA3AF" }}>N2P ใบสั่งและรับสินค้า</div>
              <h2 style={{ fontSize: 19, fontWeight: 700, color: "#111827" }}>📥 รับสินค้าเข้า</h2>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#1A56DB" }}>{openDoc.docNo ? `เลขที่ ${openDoc.docNo}` : "⚠️ ไม่พบใบสั่งซื้ออ้างอิง"}</div>
            </div>
          </div>
          <div style={{ background: "#EFF6FF", borderLeft: "3px solid #1A56DB", borderRadius: "0 10px 10px 0", padding: "12px 16px", marginBottom: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13 }}>
            <div><span style={{ color: "#6B7280" }}>วันที่สั่ง:</span> <b>{dateLabel(openDoc.orderDate)}</b></div>
            <div><span style={{ color: "#6B7280" }}>กำหนดรับ:</span> <b>{dateLabel(openDoc.needDate)}</b></div>
            <div><span style={{ color: "#6B7280" }}>ผู้สั่ง:</span> {openDoc.orderedBy || "-"}</div>
            <div><span style={{ color: "#6B7280" }}>หมายเลขสั่งซื้อ:</span> {openDoc.supplier || "-"}</div>
            <div><span style={{ color: "#6B7280" }}>หมายเลขพัสดุ:</span> {openDoc.channel || "-"}</div>
            {openDoc.orderNote && <div style={{ gridColumn: "1 / -1" }}><span style={{ color: "#6B7280" }}>หมายเหตุ:</span> {openDoc.orderNote}</div>}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
            {openDoc.items.map(it => {
              const f = formItems[it.roundKey] || { receivedQty: 0, note: "", productId: it.productId };
              const p = f.productId ? products.find(x => String(x.id) === String(f.productId)) : null;
              const done = it.pendingQty <= 0;
              return (
                <div key={it.roundKey} style={{ border: "1px solid " + (done ? "#E5E7EB" : "#DDD6FE"), borderRadius: 12, padding: 12, background: done ? "#F9FAFB" : "#FAFAFF" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: "#111827" }}>{it.name}</div>
                      <div style={{ fontSize: 11.5, color: "#6B7280" }}>สั่งไว้ {it.orderedQty} {it.unit || "ชิ้น"}{done ? " · รับครบแล้ว" : ` · เหลือรอรับ ${it.pendingQty}`}</div>
                    </div>
                    {done && <span style={{ fontSize: 11, fontWeight: 700, color: "#059669", background: "#D1FAE5", borderRadius: 999, padding: "2px 10px", whiteSpace: "nowrap" }}>✓ รับครบแล้ว</span>}
                  </div>
                  {!done && (
                    <>
                      <div style={{ marginBottom: 8 }}>
                        <ProductPicker products={products} value={p ? String(p.id) : "none"}
                          autoLabel={it.productId ? (p ? p.name : "สินค้านี้ถูกลบไปแล้ว") : "— ไม่พบสินค้าที่ตรงกัน —"}
                          onPick={v => updateItem(it.roundKey, { productId: v === "auto" || v === "none" ? null : parseInt(v) })} />
                      </div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <label style={{ fontSize: 12, color: "#6B7280" }}>จำนวนที่รับจริง
                          <input type="number" min={0} className="inp" style={{ width: 90, padding: "6px 8px", marginLeft: 6 }}
                            value={f.receivedQty} onChange={e => updateItem(it.roundKey, { receivedQty: e.target.value })} />
                        </label>
                        <input className="inp" style={{ flex: 1, minWidth: 160, padding: "6px 8px" }} placeholder="หมายเหตุ (ถ้ามี เช่น ของขาด/กล่องบุบ)"
                          value={f.note} onChange={e => updateItem(it.roundKey, { note: e.target.value })} />
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid #F0EDE8", paddingTop: 14 }}>
            <input className="inp" style={{ flex: 1, minWidth: 200 }} placeholder="ชื่อผู้รับสินค้า (คลัง) *" value={by} onChange={e => setBy(e.target.value)} />
            <button onClick={submit} disabled={saving}
              style={{ background: "linear-gradient(135deg,#7C3AED,#3B82F6)", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>
              {saving ? "⏳ กำลังบันทึก..." : "📥 บันทึกรับเข้าใบนี้"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 4 }}>📥 รับสินค้าเข้า</h2>
        <p style={{ fontSize: 13, color: "#6B7280" }}>รายการรอรับแยกตามใบสั่งซื้อ แทนใบพิมพ์กระดาษ — บันทึกแล้วยังไม่เข้าสต็อกทันที ต้องรอผู้จัดการตรวจสอบและยืนยันก่อนเสมอ</p>
      </div>

      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: 14, marginBottom: 14 }}>
        <input className="inp" style={{ width: "100%", marginBottom: 12 }} placeholder="🔍 ค้นหาเลขที่ใบสั่งซื้อ / ชื่อสินค้า..."
          value={search} onChange={e => setSearch(e.target.value)} />
        <div style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", marginBottom: 6 }}>ใบสั่งซื้อที่ยังรอรับ ({shownDocs.length})</div>
        {shownDocs.length === 0 && <div style={{ textAlign: "center", padding: 24, color: "#9CA3AF", fontSize: 13 }}>{kw ? "ไม่พบใบสั่งซื้อที่ตรงกับคำค้นหา" : "ไม่มีใบสั่งซื้อที่รอรับ 🎉"}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {shownDocs.map(doc => {
            const pendingItems = doc.items.filter(it => it.pendingQty > 0);
            const pendingCount = pendingItems.length;
            const unmatchedCount = pendingItems.filter(it => !it.productId).length;
            const itemNames = pendingItems.map(it => it.name).join(", ");
            return (
              <div key={doc.docKey} onClick={() => openDocFor(doc)}
                style={{ border: "1px solid #E5E7EB", borderRadius: 12, padding: "12px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}
                onMouseEnter={e => e.currentTarget.style.background = "#F9FAFB"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{doc.docNo || "⚠️ ไม่พบใบสั่งซื้ออ้างอิง"}</span>
                    {doc.docId != null && <span style={{ fontSize: 10.5, fontWeight: 700, color: "#7C3AED", background: "#F5F3FF", borderRadius: 999, padding: "1px 8px" }}>⚡ จากสินค้ารอสั่ง</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#9CA3AF", marginTop: 1 }}>{doc.supplier ? `#${doc.supplier} · ` : ""}{dateLabel(doc.orderDate)}</div>
                  <div style={{ fontSize: 13, color: "#374151", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{itemNames}</div>
                  <div style={{ fontSize: 11.5, color: "#6B7280", marginTop: 2 }}>
                    {doc.channel ? `หมายเลขพัสดุ ${doc.channel} · ` : <span style={{ color: "#DC2626", fontWeight: 700 }}>กรุณาใส่หมายเลขพัสดุ · </span>}
                    {pendingCount} รายการรอรับ{unmatchedCount > 0 ? ` · ⚠️ ${unmatchedCount} รายการยังไม่พบสินค้าที่ตรงกัน` : ""}
                  </div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#7C3AED", flexShrink: 0 }}>เปิดดู →</span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "#111827", marginBottom: 10 }}>🕘 ที่เพิ่งบันทึกไว้ — รอผู้จัดการอนุมัติ ({myPending.length})</div>
        {myPending.length === 0 && <div style={{ textAlign: "center", padding: 16, color: "#9CA3AF", fontSize: 13 }}>ยังไม่มีรายการรออนุมัติ</div>}
        {myPending.slice(0, 20).map(r => (
          <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #F3F4F6", fontSize: 13 }}>
            <div>
              <div style={{ color: "#111827", fontWeight: 600 }}>{r.product_name || r.backlog_item_name}{!r.product_id && <span style={{ marginLeft: 6, fontSize: 11, color: "#DC2626" }}>⚠️ ยังไม่จับคู่สินค้า</span>}</div>
              <div style={{ fontSize: 11, color: "#9CA3AF" }}>{r.doc_no ? `ใบสั่งซื้อ ${r.doc_no} · ` : ""}{fmtDT(r.created_at)} · โดย {r.received_by || "-"}{r.note ? ` · ${r.note}` : ""}</div>
            </div>
            <span style={{ fontWeight: 700, color: "#7C3AED" }}>+{r.received_qty}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════ รับเข้ารออนุมัติ — ผู้จัดการตรวจก่อนเข้าสต็อกจริง (อยู่ในเช็คสต็อกที่ล็อกรหัสอยู่แล้ว) ═══════════
// onStockChange(productId, newQty, txRow) — ใช้ตัวเดียวกับ applyPickCut ของหน้าหลัก เพื่อให้ state สินค้า/ประวัติซิงค์กันทันที
function ReceivingApprovalPanel({ products, onStockChange, onReceivingLogChange, showToast }) {
  const [allLogs, setAllLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [approverBy, setApproverBy] = useState("");
  const [edits, setEdits] = useState({}); // { [id]: { receivedQty, productId, skip } }
  const [busyId, setBusyId] = useState(null);
  const [view, setView] = useState("pending"); // "pending" | "history"
  const [historySearch, setHistorySearch] = useState("");
  const historyDateFilter = useDateFilterState("all");

  const load = async () => {
    setLoading(true);
    try { setAllLogs(await api.getReceivingLogs()); }
    catch (e) { showToast(e.message, "error"); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const pending = useMemo(() => allLogs.filter(r => r.status === "pending"), [allLogs]);
  const history = useMemo(() => {
    const kw = historySearch.trim().toLowerCase();
    return allLogs.filter(r => {
      if (r.status === "pending") return false;
      const day = (r.approved_at || r.created_at || "").slice(0, 10);
      if (historyDateFilter.mode !== "all" && (day < historyDateFilter.rangeFrom || day > historyDateFilter.rangeTo)) return false;
      if (kw && !(r.product_name || r.backlog_item_name || "").toLowerCase().includes(kw)) return false;
      return true;
    }).sort((a, b) => (b.approved_at || b.created_at || "").localeCompare(a.approved_at || a.created_at || ""));
  }, [allLogs, historySearch, historyDateFilter.mode, historyDateFilter.rangeFrom, historyDateFilter.rangeTo]);

  const getEdit = (row) => edits[row.id] || { receivedQty: row.received_qty, productId: row.product_id, skip: false };
  const setEdit = (id, patch) => setEdits(prev => {
    const row = pending.find(r => r.id === id);
    const current = prev[id] || { receivedQty: row.received_qty, productId: row.product_id, skip: false };
    return { ...prev, [id]: { ...current, ...patch } };
  });

  const confirmRow = async (row) => {
    const e = getEdit(row);
    if (!approverBy.trim()) return showToast("กรุณากรอกชื่อผู้อนุมัติก่อน", "error");
    setBusyId(row.id);
    try {
      if (e.skip) {
        const updated = await api.updateReceivingLog(row.id, { status: "skipped", approved_by: approverBy.trim(), approved_at: new Date().toISOString() });
        if (onReceivingLogChange && updated) onReceivingLogChange(updated);
        if (updated) setAllLogs(prev => prev.map(r => r.id === updated[0].id ? updated[0] : r));
        showToast("ตั้งเป็น \"ไม่บันทึกลงคลัง\" แล้ว");
      } else {
        const qty = Number(e.receivedQty) || 0;
        const product = products.find(p => String(p.id) === String(e.productId));
        if (!product) return showToast("กรุณาเลือกสินค้าให้ถูกต้องก่อนยืนยัน", "error");
        if (qty <= 0) return showToast("จำนวนต้องมากกว่า 0", "error");
        const newQty = product.quantity + qty;
        await api.updateProduct(product.id, { quantity: newQty });
        const [newTx] = await api.addTransaction({
          type: "in", product_id: product.id, quantity: qty, date: new Date().toISOString().split("T")[0],
          note: `รับเข้าจากใบสั่งซื้อ (${row.backlog_item_name})${row.note ? " - " + row.note : ""}`, by: approverBy.trim(),
        });
        onStockChange(product.id, newQty, newTx);
        try {
          await syncApprovalToOrderSystem(row, qty);
        } catch (syncErr) {
          showToast(`เพิ่มสต็อกสำเร็จ แต่ตัดยอดในใบสั่งซื้อไม่สำเร็จ: ${syncErr.message}`, "error");
        }
        const updated = await api.updateReceivingLog(row.id, {
          status: "approved", approved_by: approverBy.trim(), approved_at: new Date().toISOString(),
          received_qty: qty, product_id: product.id, product_name: product.name, sku: product.sku,
        });
        if (onReceivingLogChange && updated) onReceivingLogChange(updated);
        if (updated) setAllLogs(prev => prev.map(r => r.id === updated[0].id ? updated[0] : r));
        showToast(`เพิ่มเข้าสต็อก "${product.name}" +${qty} สำเร็จ · ตัดยอดในใบสั่งซื้อให้แล้ว`);
      }
    } catch (err) { showToast(err.message, "error"); }
    setBusyId(null);
  };

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 4 }}>📥 รับเข้ารออนุมัติ</h2>
        <p style={{ fontSize: 13, color: "#6B7280" }}>รายการที่ฝ่ายคลังบันทึกรับเข้าไว้ ({pending.length} รายการ) — ตรวจสอบแล้วค่อยยืนยันเข้าสต็อกจริง</p>
      </div>

      <div className="filter-tabs" style={{ display: "flex", gap: 4, background: "#EAEFED", borderRadius: 12, padding: 4, marginBottom: 14, width: "fit-content" }}>
        {[["pending", `⏳ รออนุมัติ (${pending.length})`], ["history", "📜 ประวัติ"]].map(([v, l]) => (
          <button key={v} onClick={() => setView(v)}
            style={{ background: view === v ? "#7C3AED" : "transparent", color: view === v ? "#fff" : "#6B7280", border: "none", borderRadius: 9, padding: "8px 16px", fontSize: 13, fontWeight: view === v ? 700 : 500, cursor: "pointer" }}>
            {l}
          </button>
        ))}
      </div>

      {loading && <div style={{ textAlign: "center", padding: 30, color: "#6B7280" }}>กำลังโหลด...</div>}

      {!loading && view === "pending" && (
      <>
      <div style={{ background: "#FFFBEB", border: "1.5px solid #FDE68A", borderRadius: 14, padding: "12px 16px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 18 }}>⚠️</span>
        <div style={{ fontSize: 13, color: "#92400E" }}><b>ตรวจสอบให้แน่ใจว่าสินค้าที่จับคู่ตรงกับของจริงก่อนยืนยันทุกครั้ง</b> — ถ้าจับคู่ผิดสินค้าจะทำให้สต็อกของสินค้านั้นคลาดเคลื่อน</div>
      </div>

      <div style={{ marginBottom: 14, maxWidth: 300 }}>
        <input className="inp" style={{ width: "100%" }} placeholder="ชื่อผู้อนุมัติ *" value={approverBy} onChange={e => setApproverBy(e.target.value)} />
      </div>

      {pending.length === 0 && (
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, textAlign: "center", padding: 40, color: "#9CA3AF" }}>ไม่มีรายการรออนุมัติ 🎉</div>
      )}
      {pending.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {pending.map(row => {
            const e = getEdit(row);
            const product = e.productId ? products.find(p => String(p.id) === String(e.productId)) : null;
            return (
              <div key={row.id} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: 14 }}>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 2 }}>ชื่อตามใบสั่งซื้อ{row.doc_no ? ` · เลขที่ ${row.doc_no}` : ""}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#111827", marginBottom: 8 }}>{row.backlog_item_name}</div>
                    <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 2 }}>จับคู่กับสินค้าในคลัง</div>
                    <ProductPicker products={products} value={product ? String(product.id) : "none"}
                      autoLabel={e.productId ? "สินค้านี้ถูกลบไปแล้ว" : "— ยังไม่ได้จับคู่ —"}
                      onPick={v => setEdit(row.id, { productId: v === "auto" || v === "none" ? null : parseInt(v) })} />
                    {product && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, padding: "8px 10px", background: "#F5F3FF", borderRadius: 10 }}>
                        {product.imageUrl
                          ? <img src={product.imageUrl} alt="" style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 6, border: "1px solid #E5E7EB" }} />
                          : <div style={{ width: 32, height: 32, borderRadius: 6, background: "#EDE9FE", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>📦</div>}
                        <div style={{ fontSize: 12 }}>
                          <div style={{ fontWeight: 700, color: "#111827" }}>{product.name} <span style={{ color: "#9CA3AF", fontWeight: 400 }}>({product.sku})</span></div>
                          <div style={{ color: "#6B7280" }}>คงเหลือตอนนี้ {product.quantity} {product.unit}</div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ width: 200, flexShrink: 0 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#374151", marginBottom: 10, cursor: "pointer" }}>
                      <input type="checkbox" checked={e.skip} onChange={ev => setEdit(row.id, { skip: ev.target.checked })} />
                      ไม่บันทึกลงคลัง (ของเบ็ดเตล็ด)
                    </label>
                    {!e.skip && (
                      <label style={{ fontSize: 12, color: "#6B7280", display: "block", marginBottom: 10 }}>จำนวนที่จะเพิ่มเข้าสต็อก
                        <input type="number" min={0} className="inp" style={{ width: "100%", padding: "6px 8px", marginTop: 4 }}
                          value={e.receivedQty} onChange={ev => setEdit(row.id, { receivedQty: ev.target.value })} />
                      </label>
                    )}
                    <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 10 }}>
                      บันทึกโดย {row.received_by || "-"} · {fmtDT(row.created_at)}{row.note ? <><br />หมายเหตุ: {row.note}</> : ""}
                    </div>
                    <button onClick={() => confirmRow(row)} disabled={busyId === row.id}
                      style={{ width: "100%", background: e.skip ? "#F9FAFB" : "#059669", color: e.skip ? "#6B7280" : "#fff", border: e.skip ? "1px solid #E5E7EB" : "none", borderRadius: 10, padding: "9px 12px", fontSize: 13, fontWeight: 700, cursor: busyId === row.id ? "not-allowed" : "pointer" }}>
                      {busyId === row.id ? "⏳..." : e.skip ? "🚫 ยืนยันไม่บันทึกลงคลัง" : "✅ ยืนยันเพิ่มเข้าสต็อก"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </>
      )}

      {!loading && view === "history" && (
        <div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
            <DateFilterRow filter={historyDateFilter} accent="linear-gradient(135deg,#7C3AED,#3B82F6)" />
            <input className="inp" style={{ minWidth: 220 }} placeholder="🔍 กรองชื่อสินค้า..." value={historySearch} onChange={e => setHistorySearch(e.target.value)} />
          </div>
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, overflow: "hidden", overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>วันที่</th><th>ชื่อสินค้า</th><th>SKU</th><th>จำนวน</th><th>ใบสั่งซื้อ</th><th>สถานะ</th><th>บันทึกโดย</th><th>อนุมัติโดย</th><th>หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {history.map(r => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap", fontSize: 12, color: "#6B7280" }}>{fmtDT(r.approved_at || r.created_at)}</td>
                    <td style={{ fontWeight: 600 }}>{r.product_name || r.backlog_item_name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.sku || "-"}</td>
                    <td style={{ fontFamily: "monospace" }}>{r.received_qty}</td>
                    <td style={{ fontSize: 12, color: "#6B7280" }}>{r.doc_no || "-"}</td>
                    <td>
                      <span style={{ background: r.status === "approved" ? "#D1FAE5" : "#F3F4F6", color: r.status === "approved" ? "#059669" : "#6B7280", borderRadius: 6, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>
                        {r.status === "approved" ? "✅ เข้าสต็อกแล้ว" : "🚫 ไม่บันทึกลงคลัง"}
                      </span>
                    </td>
                    <td>{r.received_by || "-"}</td>
                    <td>{r.approved_by || "-"}</td>
                    <td style={{ fontSize: 12, color: "#6B7280" }}>{r.note || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {history.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "#9CA3AF" }}>ไม่พบรายการ</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function WarehouseApp() {
  const [rawProducts, setRawProducts] = useState([]);
  const [aliasMap, setAliasMap] = useState(new Map()); // ชื่อสินค้าตาม myorder → [{product_id, qty}] (จากตาราง product_aliases)
  const [backlog, setBacklog] = useState([]);            // n2p_backlog จากระบบใบสั่ง — ใช้แค่คำนวณ "รอเข้า" (ของที่สั่งซัพพลายเออร์แล้วยังไม่มาส่ง) เท่านั้น
  const [backlogNotes, setBacklogNotes] = useState(null); // backlog_notes ในตัว StockMaster เอง — ใช้คำนวณ "ค้างส่ง" (ค้างส่งลูกค้าจาก MyOrder) แทนของเดิมที่เคยอิงระบบใบสั่ง
  const [receivingLogs, setReceivingLogs] = useState([]); // ใช้หักยอด "รอเข้า" ชั่วคราวเฉพาะรายการที่ฝ่ายคลังบันทึกไว้แต่ยัง "รออนุมัติ" (status=pending) กันเห็นซ้ำ/บันทึกซ้ำก่อนผู้จัดการกดยืนยัน — พออนุมัติแล้ว StockMaster เขียนกลับเข้า n2p_backlog.rounds.receivedQty ให้เองอัตโนมัติ (syncApprovalToOrderSystem) ยอดรอเข้าจะถูกต้องจากต้นทางโดยตรง
  const [showIncomingModal, setShowIncomingModal] = useState(false);
  const [incomingAlias, setIncomingAlias] = useState(loadAliasMap);
  const [incomingSearch, setIncomingSearch] = useState("");
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ทั้งหมด");
  const [statusFilter, setStatusFilter] = useState("ทั้งหมด");
  const [showModal, setShowModal] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [txType, setTxType] = useState("in");
  const [form, setForm] = useState({});
  const [txForm, setTxForm] = useState({ productId: "", quantity: "", note: "", by: "" });
  const [toast, setToast] = useState(null);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [pinnedIds, setPinnedIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem("pinnedProducts") || "[]"); } catch { return []; }
  });
  const [clearanceIds, setClearanceIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem("clearanceProducts") || "[]"); } catch { return []; }
  });
  const [disposeMode, setDisposeMode] = useState(false);
  const [selectedForDispose, setSelectedForDispose] = useState(new Set());
  const [showAllDormant, setShowAllDormant] = useState(false);
  const [disposeRecords, setDisposeRecords] = useState([]);
  const [loadingDispose, setLoadingDispose] = useState(false);
  const [disposeSearch, setDisposeSearch] = useState("");
  const [historyProduct, setHistoryProduct] = useState(null); // product ที่กดดูประวัติ
  const [filterProductId, setFilterProductId] = useState(null); // filter transactions by product
  const txDateFilter = useDateFilterState("all"); // ตัวกรองวันที่/เดือนของรายการเคลื่อนไหว
  const [exportingTx, setExportingTx] = useState(false);
  const [stockCheckMode, setStockCheckMode] = useState(false); // โหมดเช็ค/ปรับสต็อก
  const [stockCounts, setStockCounts] = useState({}); // { [productId]: "จำนวนนับจริง" }
  const [stockSub, setStockSub] = useState("orders"); // เมนูย่อยของ "เช็คสต็อก": orders | adjust | print | labels | receivingApproval | reorder | transactions | dispose (backlog ย้ายออกไปเป็นแท็บหลักแล้ว)
  const [checkerName, setCheckerName] = useState(""); // ผู้ตรวจนับ
  const [savingStockCheck, setSavingStockCheck] = useState(false);
  const [reorderDays, setReorderDays] = useState(7); // จำนวนวันที่ต้องการให้สต็อกพอ ในหน้า "ต้องสั่งซื้อ"
  const [reorderSearch, setReorderSearch] = useState(""); // ค้นหาชื่อสินค้า/SKU ในหน้า "ต้องสั่งซื้อ"

  // ── ยอดออเดอร์ (จาก MyOrder extension) — ไว้ให้แอดมินเทียบกับที่พนักงานตัดสต็อกจริง ──
  const [orderScans, setOrderScans] = useState([]);
  const [loadingOrderScans, setLoadingOrderScans] = useState(false);
  const [orderScanSearch, setOrderScanSearch] = useState("");
  const [expandedScanIds, setExpandedScanIds] = useState(new Set());
  const [reviewerName, setReviewerName] = useState("");
  const [scansUnlocked, setScansUnlocked] = useState(false); // ตั้งใจไม่จำข้ามการรีเฟรช — ผู้ใช้ขอให้ทุกครั้งที่รีเฟรชหน้าต้องกรอกรหัสใหม่เสมอ
  const [scanPasswordInput, setScanPasswordInput] = useState("");
  const [scanPasswordError, setScanPasswordError] = useState("");
  const [orderScansView, setOrderScansView] = useState("summary"); // "summary" | "list"
  const [expandedCompareDates, setExpandedCompareDates] = useState(new Set());
  const [scanDateFrom, setScanDateFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 13); return localDateStr(d); });
  const [scanDateTo, setScanDateTo] = useState(() => localDateStr(new Date()));

  const toggleCompareDate = (date) => {
    setExpandedCompareDates(prev => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  };

  const handleUnlockScans = () => {
    if (scanPasswordInput === ORDER_SCANS_PASSWORD) {
      setScansUnlocked(true);
      setScanPasswordError("");
      setScanPasswordInput("");
    } else {
      setScanPasswordError("รหัสไม่ถูกต้อง");
    }
  };

  // ── รับเข้าตีกลับ (หลายรายการ ครั้งเดียว) ──
  const [showReturnBatchModal, setShowReturnBatchModal] = useState(false);
  const [returnBatchSearch, setReturnBatchSearch] = useState("");
  const [returnBatchBy, setReturnBatchBy] = useState("");
  const [returnBatchItems, setReturnBatchItems] = useState([]); // [{productId, name, sku, unit, quantity}]
  const [returnBatchIsReturn, setReturnBatchIsReturn] = useState(false); // ติ๊ก = รับเข้าแบบ "ตีกลับ" (บันทึกหมายเหตุอัตโนมัติ), ไม่ติ๊ก = รับเข้าปกติ
  const [returnBatchSelectedIds, setReturnBatchSelectedIds] = useState(new Set()); // เลือกจากผลค้นหาไว้เพิ่มพร้อมกันหลายตัว
  const [savingReturnBatch, setSavingReturnBatch] = useState(false);

  // ── เบิกออก (หลายรายการ ครั้งเดียว) ──
  const [showOutBatchModal, setShowOutBatchModal] = useState(false);
  const [outBatchSearch, setOutBatchSearch] = useState("");
  const [outBatchBy, setOutBatchBy] = useState("");
  const [outBatchItems, setOutBatchItems] = useState([]); // [{productId, name, sku, unit, quantity, maxQty}]
  const [savingOutBatch, setSavingOutBatch] = useState(false);

  const loadDisposeRecords = async () => {
    setLoadingDispose(true);
    try {
      const data = await sb("dispose_records?select=*&order=disposed_at.desc");
      setDisposeRecords(data || []);
    } catch (e) { console.error(e); }
    setLoadingDispose(false);
  };

  const loadOrderScans = async () => {
    setLoadingOrderScans(true);
    try {
      const data = await api.getOrderScans();
      setOrderScans(data || []);
    } catch (e) { console.error(e); }
    setLoadingOrderScans(false);
  };

  const toggleScanExpanded = (id) => {
    setExpandedScanIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleScanReviewed = async (scan) => {
    try {
      if (scan.reviewed) {
        await api.unreviewOrderScan(scan.id);
        setOrderScans(prev => prev.map(s => s.id === scan.id ? { ...s, reviewed: false, reviewed_by: null, reviewed_at: null } : s));
      } else {
        if (!reviewerName.trim()) return showToast("กรุณากรอกชื่อผู้ตรวจก่อน", "error");
        await api.reviewOrderScan(scan.id, reviewerName.trim());
        setOrderScans(prev => prev.map(s => s.id === scan.id ? { ...s, reviewed: true, reviewed_by: reviewerName.trim(), reviewed_at: new Date().toISOString() } : s));
      }
    } catch (e) { showToast(e.message, "error"); }
  };

  const handleDeleteScan = async (scan) => {
    if (!window.confirm(`ลบรายการนี้ถาวร?\n${scan.page_name || "ไม่ระบุ"} · ${scan.total_orders} ออเดอร์ · ${scan.total_items} ชิ้น`)) return;
    try {
      await api.deleteOrderScan(scan.id);
      setOrderScans(prev => prev.filter(s => s.id !== scan.id));
      showToast("ลบรายการแล้ว");
    } catch (e) { showToast(e.message, "error"); }
  };

  const handleChangeScanDate = async (scan, newDate) => {
    if (!newDate) return;
    try {
      await api.setOrderScanEffectiveDate(scan.id, newDate);
      setOrderScans(prev => prev.map(s => s.id === scan.id ? { ...s, effective_date: newDate } : s));
      showToast("ย้ายวันที่ใช้เทียบแล้ว");
    } catch (e) { showToast(e.message, "error"); }
  };

  const toggleDispose = (id) => {
    setSelectedForDispose(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleExportDispose = async () => {
    const items = products.filter(p => selectedForDispose.has(p.id));
    if (items.length === 0) return;
    try {
      const XLSX = await loadXLSX();
      const HEADER = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "DC2626" } } };
      const wb = XLSX.utils.book_new();
      const dateStr = new Date().toLocaleDateString("th-TH", { dateStyle: "long" });
      const ws = XLSX.utils.aoa_to_sheet([
        [{ v: "รายงานสินค้าจำหน่ายออก / ตัดสต็อก", s: { font: { bold: true, sz: 14 } } }, "", "", "", ""],
        ["วันที่ออกรายงาน", dateStr, "", "", ""],
        ["", "", "", "", ""],
        [
          { v: "SKU", s: HEADER }, { v: "ชื่อสินค้า", s: HEADER },
          { v: "คงเหลือสุดท้าย", s: HEADER }, { v: "หน่วย", s: HEADER },
          { v: "ราคาทุน (฿)", s: HEADER }, { v: "มูลค่าที่ตัดออก (฿)", s: HEADER },
        ],
        ...items.map(p => [
          p.sku, p.name,
          { v: p.quantity, s: { fill: { fgColor: { rgb: "FFCCCC" } } } },
          p.unit, p.price,
          { v: Math.max(0, p.quantity) * p.price, s: { fill: { fgColor: { rgb: "FFCCCC" } } } },
        ]),
        ["", "", "", "", ""],
        [{ v: "รวมมูลค่าที่ตัดออกทั้งหมด", s: { font: { bold: true } } }, "", "",
         "", "", { v: items.reduce((s, p) => s + Math.max(0, p.quantity) * p.price, 0), s: { font: { bold: true } } }],
      ]);
      ws["!cols"] = [{ wch: 14 }, { wch: 32 }, { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, ws, "สินค้าจำหน่ายออก");
      XLSX.writeFile(wb, `dispose_report_${todayStr()}.xlsx`);
    } catch (e) { alert("Export ไม่สำเร็จ: " + e.message); }
  };

  const handleConfirmDispose = async () => {
    const items = products.filter(p => selectedForDispose.has(p.id));
    if (items.length === 0) return;
    const disposedBy = window.prompt("ชื่อผู้ทำรายการจำหน่ายออก:");
    if (!disposedBy || !disposedBy.trim()) return;
    const note = window.prompt("หมายเหตุ (ถ้ามี):", "สินค้าหมดอายุ/ยกเลิกขาย") || "";
    if (!confirm(`ยืนยันจำหน่ายออก ${items.length} รายการ โดย "${disposedBy.trim()}"\n${"─".repeat(40)}\n${items.slice(0,10).map(p => `• ${p.name}\n  คงเหลือสุดท้าย: ${p.quantity} ${p.unit} | มูลค่า: ฿${(Math.max(0,p.quantity)*p.price).toLocaleString()}`).join("\n")}${items.length > 10 ? `\n...และอีก ${items.length-10} รายการ` : ""}\n${"─".repeat(40)}\nมูลค่ารวมที่ตัดออก: ฿${items.reduce((s,p)=>s+Math.max(0,p.quantity)*p.price,0).toLocaleString()}\n\n⚠️ การดำเนินการนี้ไม่สามารถย้อนกลับได้`)) return;
    try {
      const now = new Date().toISOString();
      for (const p of items) {
        // 1. บันทึกลง dispose_records
        try {
          await sb("dispose_records", { method: "POST", body: JSON.stringify({
            product_id: p.id, sku: p.sku, name: p.name,
            final_quantity: p.quantity, unit: p.unit, price: p.price,
            total_value: Math.max(0, p.quantity) * p.price,
            disposed_by: disposedBy.trim(), disposed_at: now, note,
          })});
        } catch {}
        // 2. ลบ transactions ของสินค้านี้ก่อน (แก้ FK constraint)
        try {
          await sb(`transactions?product_id=eq.${p.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        } catch {}
        // 3. ลบสินค้า
        await api.deleteProduct(p.id);
      }
      setRawProducts(prev => prev.filter(p => !selectedForDispose.has(p.id)));
      setTransactions(prev => prev.filter(tx => !selectedForDispose.has(tx.productId)));
      setSelectedForDispose(new Set());
      setDisposeMode(false);
      loadDisposeRecords();
      showToast(`จำหน่ายออก ${items.length} รายการสำเร็จ บันทึกไว้ในระบบแล้ว`);
    } catch (e) { showToast(e.message, "error"); }
  };

  const togglePin = (id) => {
    const sid = String(id);
    setPinnedIds(prev => {
      const next = prev.includes(sid) ? prev.filter(x => x !== sid) : [...prev, sid];
      localStorage.setItem("pinnedProducts", JSON.stringify(next));
      return next;
    });
  };

  const toggleClearance = (id) => {
    const sid = String(id);
    setClearanceIds(prev => {
      const next = prev.includes(sid) ? prev.filter(x => x !== sid) : [...prev, sid];
      localStorage.setItem("clearanceProducts", JSON.stringify(next));
      return next;
    });
  };
  const [saving, setSaving] = useState(false);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ── ยิงตัดสต๊อกจากใบหยิบ: panel ยิง API เอง แล้วส่งผลกลับมาให้ state หลักตรงกัน ──
  const applyPickCut = (productId, newQty, txRow) => {
    setRawProducts(prev => prev.map(p => p.id === productId ? { ...p, quantity: newQty } : p));
    if (txRow) setTransactions(prev => [dbToTx(txRow), ...prev]);
  };
  const openAddProductNamed = (name) => { setForm({ name: stripPromo(name) || name }); setShowModal("add"); };
  // ให้หน้า "รับสินค้าเข้า"/"รับเข้ารออนุมัติ" อัปเดต state ตัวนี้ทันทีที่บันทึก/อนุมัติ ไม่งั้นคอลัมน์ "รอเข้า" จะค้างเลขเก่าจนกว่าจะโหลดหน้าใหม่
  const upsertReceivingLogs = (rows) => {
    const list = Array.isArray(rows) ? rows : [rows];
    setReceivingLogs(prev => {
      const byId = new Map(prev.map(r => [r.id, r]));
      list.forEach(r => byId.set(r.id, r));
      return [...byId.values()];
    });
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    setDbError(null);
    try {
      const [prods, txs, bl, al, bn, rl] = await Promise.all([
        api.getProducts(),
        api.getTransactions(),
        // ของระบบใบสั่ง — ถ้าดึงไม่ได้ก็ให้คลังทำงานต่อได้ตามปกติ แค่ไม่มียอดรอเข้า
        api.getBacklog().catch(() => []),
        // การจับคู่ชื่อ myorder → SKU — ตารางยังไม่ถูกสร้าง (ยังไม่รัน scan-verify-setup.sql) ก็ไม่ให้แอปพัง
        api.getAliases().catch(() => []),
        // บันทึกค้างส่งในตัว StockMaster เอง — ถ้าดึงไม่ได้ (ยังไม่รัน backlog-notes-setup.sql) ก็ให้คลังทำงานต่อได้ แค่ไม่มียอดค้างส่ง
        api.getBacklogNotes().catch(() => null),
        // ที่รับเข้าไปแล้วผ่าน StockMaster — ถ้าดึงไม่ได้ (ยังไม่รัน receiving-logs-setup.sql) ก็ให้ยอดรอเข้าคำนวณแบบเดิมไปก่อน
        api.getReceivingLogs().catch(() => []),
      ]);
      setRawProducts((prods || []).map(dbToProduct));
      setTransactions((txs || []).map(dbToTx));
      setBacklog(bl || []);
      setAliasMap(aliasRowsToMap(al));
      setBacklogNotes(bn);
      setReceivingLogs(rl || []);
    } catch (e) {
      setDbError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { if (tab === "stockcheck" && stockSub === "dispose" && scansUnlocked) loadDisposeRecords(); }, [tab, stockSub, scansUnlocked]);
  useEffect(() => { if (tab === "stockcheck" && stockSub === "orders" && scansUnlocked) loadOrderScans(); }, [tab, stockSub, scansUnlocked]);
  // เมนูย่อยของ "เช็คสต็อก" เป็นตัวกำหนดโหมดของตารางสินค้า — ออกจากแท็บเมื่อไหร่โหมดดับ · "จำหน่ายออก" เข้ามาก่อนเห็นเป็นหน้าประวัติ ต้องกดปุ่ม "+ จำหน่ายออกเพิ่ม" เองถึงเข้าโหมดเลือกรายการ (ไม่บังคับอัตโนมัติเหมือนก่อน)
  useEffect(() => {
    const inStock = tab === "stockcheck";
    setStockCheckMode(inStock && stockSub === "adjust");
    if (!(inStock && stockSub === "dispose")) setDisposeMode(false);
  }, [tab, stockSub]);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };

  // จับคู่รายการค้างสั่งจากระบบใบสั่งเข้ากับสินค้าในคลัง
  // ที่ผู้ใช้ตั้งเองมาก่อนเสมอ ถ้าไม่มีค่อยให้ระบบเดา และเดาได้ต่อเมื่อ "ชนะขาด" ตัวรองเท่านั้น
  const incoming = useMemo(() => {
    const loggedByRound = loggedQtyByRound(receivingLogs);
    const rows = backlog.map(b => {
      const inTransit = backlogInTransit(b, loggedByRound);
      const total = Number(b.total) || 0; // ยอด "ค้างส่ง" ที่แอดมินอัปเดตไว้ในระบบใบสั่ง
      const key = String(b.name || "").trim();
      const m = matchBacklogName(key, rawProducts, incomingAlias);
      return { id: b.id, name: key, inTransit, total, ...m };
    }).sort((a, b) => b.inTransit - a.inTransit);

    const byProduct = new Map();
    rows.forEach(r => {
      if (r.productId == null) return;
      const cur = byProduct.get(r.productId) || { qty: 0, sources: [] };
      cur.qty += r.inTransit;
      cur.sources.push({ name: r.name, qty: r.inTransit });
      byProduct.set(r.productId, cur);
    });
    return { rows, byProduct };
  }, [backlog, rawProducts, incomingAlias, receivingLogs]);

  // "ค้างส่ง" อิงบันทึกค้างส่งในตัว StockMaster เอง (backlog_notes เมนูย่อยใต้เช็คสต็อก) แทนระบบใบสั่งเดิม —
  // ยึดยอด myQty ของรายการที่จับคู่สินค้าได้ (matched) จากบันทึกล่าสุด ไม่รวมรายการจับคู่ไม่ได้เพราะระบุสินค้าไม่ได้
  const backlogFromNotes = useMemo(() => {
    const byProduct = new Map();
    (backlogNotes?.items || []).forEach(it => {
      if (!it.matched) return;
      byProduct.set(String(it.id), { myQty: Number(it.myQty) || 0, itemNote: it.itemNote || "" });
    });
    return byProduct;
  }, [backlogNotes]);

  // ยอด "รอเข้า" ยึดตามระบบใบสั่งอย่างเดียว (แหล่งข้อมูลจริงของสินค้าที่สั่งซัพพลายเออร์)
  // ใบไหนถูกลบทิ้ง (เช่น ล็อตสุดท้ายเข้าแล้วแต่ไม่ได้ติ๊กรับ แล้วลบใบทิ้งเลย) ยอดต้องเป็น 0 ทันที
  // ห้ามถอยไปใช้ค่าเก่าในตาราง products เด็ดขาด ไม่งั้นยอดผีจะค้างตลอดไป
  const products = useMemo(() => rawProducts.map(p => {
    const inc = incoming.byProduct.get(p.id);
    const bn = backlogFromNotes.get(String(p.id));
    return { ...p, qtyOnOrder: inc ? inc.qty : 0, incomingSources: inc ? inc.sources : null, backlogTotal: bn ? bn.myQty : 0, backlogNote: bn ? bn.itemNote : "" };
  }), [rawProducts, incoming, backlogFromNotes]);

  const incomingUnmatched = incoming.rows.filter(r => r.productId == null && (r.inTransit > 0 || r.total > 0));
  const setAlias = (name, productId) => {
    const next = { ...incomingAlias };
    if (productId === "auto") delete next[name]; else next[name] = productId;
    setIncomingAlias(next);
    try { localStorage.setItem(ALIAS_KEY, JSON.stringify(next)); } catch { /* โหมดส่วนตัวเขียนไม่ได้ ไม่เป็นไร */ }
  };

  const filteredProducts = useMemo(() => {
    const cutoff15 = new Date(); cutoff15.setDate(cutoff15.getDate() - 15);
    const recentIds15 = new Set(transactions.filter(tx => new Date(tx.date) >= cutoff15).map(tx => tx.productId));
    let arr = products.filter(p => {
      const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase());
      const matchStatus = (() => {
        if (statusFilter === "ทั้งหมด") return true;
        if (statusFilter === "ปกติ") return p.quantity > 0 && !(p.minStock > 0 && p.quantity <= p.minStock);
        if (statusFilter === "ใกล้หมด") return p.minStock > 0 && p.quantity > 0 && p.quantity <= p.minStock;
        if (statusFilter === "หมด") return p.quantity <= 0;
        if (statusFilter === "ไม่เคลื่อนไหว") return p.quantity > 0 && !recentIds15.has(p.id);
        return true;
      })();
      return matchSearch && matchStatus;
    });
    if (sortCol) {
      arr = [...arr].sort((a, b) => {
        let av = a[sortCol], bv = b[sortCol];
        const r = typeof av === "string" ? av.localeCompare(bv, "th") : av - bv;
        return sortDir === "asc" ? r : -r;
      });
    }
    const pinned = arr.filter(p => pinnedIds.includes(String(p.id)));
    const rest   = arr.filter(p => !pinnedIds.includes(String(p.id)));
    return [...pinned, ...rest];
  }, [products, search, statusFilter, sortCol, sortDir, pinnedIds, transactions]);

  const lowStock = products.filter(p => p.minStock > 0 && p.quantity <= p.minStock);
  const totalValue = products.reduce((s, p) => s + Math.max(0, p.quantity) * p.price, 0);
  const totalItems = products.reduce((s, p) => s + p.quantity, 0);

  // สินค้าไม่เคลื่อนไหว 15 วัน — หาจาก transactions
  const dormantProducts = (() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 15);
    const recentProductIds = new Set(
      transactions
        .filter(tx => new Date(tx.date) >= cutoff)
        .map(tx => tx.productId)
    );
    // สินค้าที่มีสต็อก > 0 และไม่มี transaction ใน 15 วัน
    return products.filter(p => p.quantity > 0 && !recentProductIds.has(p.id));
  })();

  // รายการที่ควรสั่งซื้อ — อิงอัตราเบิกจริง 30 วันล่าสุด, หักลบของที่สั่งรอเข้าแล้ว (qtyOnOrder) เพื่อไม่ให้สั่งซ้ำ
  const reorderList = useMemo(() => {
    const now = new Date();
    const cutoff7 = new Date(now); cutoff7.setDate(cutoff7.getDate() - 7);
    const cutoff30 = new Date(now); cutoff30.setDate(cutoff30.getDate() - 30);
    const out7 = {}, out30 = {};
    transactions.forEach(tx => {
      if (tx.type !== "out") return;
      const d = new Date(tx.date);
      if (d >= cutoff30) out30[tx.productId] = (out30[tx.productId] || 0) + tx.quantity;
      if (d >= cutoff7) out7[tx.productId] = (out7[tx.productId] || 0) + tx.quantity;
    });
    return products
      .map(p => {
        const o7 = out7[p.id] || 0;
        const o30 = out30[p.id] || 0;
        const dailyRate = o30 / 30;
        const onOrder = p.qtyOnOrder || 0;
        const available = p.quantity + onOrder; // นับของที่สั่งรอเข้าเป็นสต็อกที่กำลังจะมี ไม่ต้องสั่งซ้ำ
        const daysLeft = dailyRate > 0 ? available / dailyRate : Infinity;
        const targetQty = Math.ceil(dailyRate * reorderDays);
        const suggested = Math.max(0, targetQty - available);
        return { ...p, out7: o7, out30: o30, dailyRate, daysLeft, suggested };
      })
      .filter(p => p.suggested > 0)
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }, [products, transactions, reorderDays]);
  const reorderCost = reorderList.reduce((s, p) => s + p.suggested * p.price, 0);
  const reorderOutOfStock = reorderList.filter(p => p.quantity <= 0);
  const reorderLowStock = reorderList.filter(p => p.quantity > 0);
  const matchesReorderSearch = (p) => {
    const q = reorderSearch.trim().toLowerCase();
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
  };
  const reorderOutOfStockView = reorderOutOfStock.filter(matchesReorderSearch);
  const reorderLowStockView = reorderLowStock.filter(matchesReorderSearch);

  // ไฮไลท์ข้อความที่ตรงกับคำค้นหา
  const highlightMatch = (text, query) => {
    const q = query.trim();
    if (!q) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ background: "#FDE047", color: "#111827", borderRadius: 3, padding: "0 1px" }}>{text.slice(idx, idx + q.length)}</mark>
        {text.slice(idx + q.length)}
      </>
    );
  };

  const ReorderTable = ({ list, search }) => (
    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, overflow: "hidden", overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            <th>SKU</th><th>ชื่อสินค้า</th><th>คงเหลือ</th><th>รอเข้า</th><th>เบิก 7 วัน</th><th>เบิก 30 วัน</th><th>พอใช้อีก</th><th>แนะนำสั่ง</th><th>ประเมินราคา (฿)</th><th style={{ textAlign: "right" }}>จัดการ</th>
          </tr>
        </thead>
        <tbody>
          {list.map(p => (
            <tr key={p.id}>
              <td style={{ fontFamily: "monospace", fontSize: 12, whiteSpace: "nowrap" }}>{highlightMatch(p.sku, search)}</td>
              <td>{highlightMatch(p.name, search)}</td>
              <td style={{ fontWeight: 700, color: statusColor(p).fg }}>{p.quantity}</td>
              <td style={{ color: p.qtyOnOrder > 0 ? "#7C3AED" : "#D1D5DB", fontWeight: p.qtyOnOrder > 0 ? 700 : 400, whiteSpace: "nowrap" }}
                                title={p.incomingSources ? "จากระบบใบสั่ง:\n" + p.incomingSources.map(x => "• " + x.name + " — " + x.qty).join("\n") : undefined}>
                                {p.qtyOnOrder > 0 ? `+${p.qtyOnOrder}` : "-"}
                                {p.incomingSources && <span style={{ marginLeft: 3, fontSize: 10, opacity: 0.65 }}>🧾</span>}
                              </td>
              <td>{p.out7}</td>
              <td>{p.out30}</td>
              <td style={{ fontWeight: 700, color: p.quantity <= 0 ? "#DC2626" : p.daysLeft <= 3 ? "#D97706" : "#6B7280" }}>
                {p.quantity <= 0 ? "หมดแล้ว" : isFinite(p.daysLeft) ? `${p.daysLeft.toFixed(1)} วัน` : "-"}
              </td>
              <td style={{ fontWeight: 700, color: "#7C3AED" }}>{p.suggested.toLocaleString("th-TH")}</td>
              <td style={{ fontFamily: "monospace", fontSize: 12 }}>{(p.suggested * p.price).toLocaleString("th-TH")}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <button onClick={() => { setTxType("in"); setTxForm({ productId: String(p.id), quantity: "", note: "", by: "" }); setShowModal("tx"); }}
                  title="รับเข้า" style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", color: "#059669", borderRadius: 8, padding: "4px 9px", fontSize: 12, cursor: "pointer", marginRight: 4, fontWeight: 700 }}>📥</button>
                <button onClick={() => openEdit(p)}
                  title="ตั้งจำนวนรอเข้า" style={{ background: "#F5F3FF", border: "1px solid #DDD6FE", color: "#7C3AED", borderRadius: 8, padding: "4px 9px", fontSize: 12, cursor: "pointer" }}>✏️</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // Export สินค้าคงคลัง Excel
  const [exportingInventory, setExportingInventory] = useState(false);
  const handleExportInventory = async () => {
    setExportingInventory(true);
    try {
      const XLSX = await loadXLSX();
      const HEADER = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1A3C5E" } } };
      const GREEN  = { fill: { fgColor: { rgb: "C6EFCE" } } };
      const RED    = { fill: { fgColor: { rgb: "FFCCCC" } } };
      const ORANGE = { fill: { fgColor: { rgb: "FFE0B2" } } };
      const GRAY   = { fill: { fgColor: { rgb: "EEEEEE" } } };
      const wb = XLSX.utils.book_new();
      const dateStr = new Date().toLocaleDateString("th-TH", { dateStyle: "long" });

      // Sheet 1: สินค้าทั้งหมด
      const ws1 = XLSX.utils.aoa_to_sheet([
        [{ v: "รายการสินค้าคงคลัง N2P", s: { font: { bold: true, sz: 14 } } },"","","","","",""],
        ["วันที่เช็คสต็อค", dateStr,"","","","",""],
        ["","","","","","",""],
        [
          { v: "SKU", s: HEADER }, { v: "ชื่อสินค้า", s: HEADER }, { v: "หมวดหมู่", s: HEADER },
          { v: "คงเหลือ", s: HEADER }, { v: "หน่วย", s: HEADER },
          { v: "ราคาทุน (฿)", s: HEADER }, { v: "มูลค่ารวม (฿)", s: HEADER },
          { v: "สถานะ", s: HEADER },
        ],
        ...products.map(p => {
          const status = p.quantity <= 0 ? "หมดสต็อก" : (p.minStock > 0 && p.quantity <= p.minStock) ? "ใกล้หมด" : "ปกติ";
          const style = p.quantity <= 0 ? RED : (p.minStock > 0 && p.quantity <= p.minStock) ? ORANGE : GREEN;
          return [
            { v: p.sku }, { v: p.name }, { v: p.category },
            { v: p.quantity, s: style }, { v: p.unit },
            { v: p.price }, { v: Math.max(0, p.quantity) * p.price },
            { v: status, s: style },
          ];
        }),
        ["","","","","","",""],
        [{ v: "รวมมูลค่าทั้งหมด", s: { font: { bold: true } } },"","",{ v: totalItems },"",
         "",{ v: totalValue, s: { font: { bold: true } } },""],
      ]);
      ws1["!cols"] = [{wch:14},{wch:32},{wch:14},{wch:10},{wch:8},{wch:14},{wch:16},{wch:12}];
      XLSX.utils.book_append_sheet(wb, ws1, "สินค้าทั้งหมด");

      // Sheet 2: สินค้าใกล้หมด/หมด
      const needRestock = products.filter(p => p.minStock > 0 && p.quantity <= p.minStock);
      const ws2 = XLSX.utils.aoa_to_sheet([
        [{ v: "SKU", s: HEADER }, { v: "ชื่อสินค้า", s: HEADER }, { v: "คงเหลือ", s: HEADER },
         { v: "สต็อกขั้นต่ำ", s: HEADER }, { v: "ขาดอีก", s: HEADER }, { v: "หน่วย", s: HEADER }],
        ...needRestock.map(p => [
          p.sku, p.name,
          { v: p.quantity, s: p.quantity <= 0 ? RED : ORANGE },
          p.minStock,
          { v: Math.max(0, p.minStock - p.quantity), s: RED },
          p.unit,
        ]),
      ]);
      ws2["!cols"] = [{wch:14},{wch:32},{wch:10},{wch:14},{wch:10},{wch:8}];
      XLSX.utils.book_append_sheet(wb, ws2, "ต้องสั่งเพิ่ม");

      // Sheet 3: ไม่เคลื่อนไหว 15 วัน
      const ws3 = XLSX.utils.aoa_to_sheet([
        [{ v: "SKU", s: HEADER }, { v: "ชื่อสินค้า", s: HEADER }, { v: "คงเหลือ", s: HEADER },
         { v: "หน่วย", s: HEADER }, { v: "ราคาทุน", s: HEADER }, { v: "มูลค่า", s: HEADER }],
        ...dormantProducts.map(p => [
          { v: p.sku, s: GRAY }, p.name,
          { v: p.quantity }, p.unit, { v: p.price },
          { v: p.quantity * p.price },
        ]),
      ]);
      ws3["!cols"] = [{wch:14},{wch:32},{wch:10},{wch:8},{wch:12},{wch:14}];
      XLSX.utils.book_append_sheet(wb, ws3, "ไม่เคลื่อนไหว 15 วัน");

      XLSX.writeFile(wb, `stock_check_${todayStr()}.xlsx`);
    } catch (e) { alert("Export ไม่สำเร็จ: " + e.message); }
    setExportingInventory(false);
  };

  // ── ใบเช็คสต็อกสำหรับพิมพ์ — ตั้งใจ "ไม่" แสดงยอดคงเหลือในระบบ ──
  // เหตุผล: ถ้าพิมพ์ยอดคงเหลือติดไปด้วย คนนับจะเห็นตัวเลขแล้วนับผ่านๆ ใส่ตามยอดในระบบ
  // แทนที่จะนับจริง ทำให้เช็คสต็อกไม่ได้ผล — ใบพิมพ์นี้จึงเว้นช่องว่างให้กรอกด้วยมือแทน
  const handlePrintStockSheet = () => {
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const dateStr = new Date().toLocaleDateString("th-TH", { dateStyle: "long" });
    const rows = filteredProducts.map((p, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td>${esc(p.sku)}</td>
        <td>${esc(p.name)}</td>
        <td class="c">${esc(p.location)}</td>
        <td class="c">${esc(p.unit)}</td>
        <td class="count"></td>
        <td class="note"></td>
      </tr>`).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ใบเช็คสต็อก ${dateStr}</title>
      <style>
        body { font-family: 'Sarabun', Tahoma, sans-serif; padding: 24px; color: #111827; }
        h1 { font-size: 18px; margin: 0 0 2px; }
        .sub { font-size: 12px; color: #6B7280; margin-bottom: 14px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid #D1D5DB; padding: 6px 8px; text-align: left; }
        th { background: #F3F4F6; }
        .c { text-align: center; }
        .count { width: 70px; } .note { width: 110px; }
        tfoot td { border: none; padding-top: 18px; font-size: 12px; }
        @media print { body { padding: 8px; } }
      </style></head><body>
      <h1>📋 ใบเช็คสต็อกสินค้า</h1>
      <div class="sub">วันที่พิมพ์: ${dateStr} · ${filteredProducts.length} รายการ · <b>ผู้ตรวจนับกรอกช่อง "นับจริง" ด้วยตนเอง</b></div>
      <table>
        <thead><tr><th class="c">#</th><th>SKU</th><th>ชื่อสินค้า</th><th class="c">ที่เก็บ</th><th class="c">หน่วย</th><th class="c">นับจริง</th><th>หมายเหตุ</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="7">ผู้ตรวจนับ: ____________________&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ลงชื่อ: ____________________&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; วันที่: ____________________</td></tr></tfoot>
      </table>
      <script>window.onload = () => window.print();</script>
      </body></html>`;
    const win = window.open("", "_blank");
    if (!win) { alert("เบราว์เซอร์บล็อกการเปิดหน้าต่างพิมพ์ — กรุณาอนุญาต pop-up แล้วลองอีกครั้ง"); return; }
    win.document.write(html);
    win.document.close();
  };

  const SortTh = ({ col, label }) => {
    const active = sortCol === col;
    return (
      <th onClick={() => handleSort(col)} style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", color: active ? "#fff" : undefined }}>
        {label}<span style={{ opacity: active ? 1 : 0.35, fontSize: 10, marginLeft: 3 }}>{active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}</span>
      </th>
    );
  };

  const handleAddProduct = async () => {
    if (!form.name || !form.sku) return showToast("กรุณากรอกชื่อและ SKU", "error");
    setSaving(true);
    try {
      const [created] = await api.addProduct(productToDb(form));
      const product = dbToProduct(created);
      setRawProducts(prev => [...prev, product].sort((a,b) => a.name.localeCompare(b.name, "th")));
      // สินค้าใหม่ที่ใส่จำนวนเริ่มต้น > 0 ให้บันทึก log "รับเข้า" ไว้ด้วย จะได้มีวันที่ตั้งต้นในประวัติ
      const initialQty = parseInt(form.quantity) || 0;
      if (initialQty > 0) {
        const [newTx] = await api.addTransaction({
          type: "in", product_id: product.id, quantity: initialQty,
          date: new Date().toISOString().split("T")[0], note: "เพิ่มสินค้าใหม่ (ยอดเริ่มต้น)", by: "ระบบ",
        });
        setTransactions(prev => [dbToTx(newTx), ...prev]);
      }
      setShowModal(null); setForm({});
      showToast("เพิ่มสินค้าสำเร็จ");
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  // บันทึก log การปรับสต็อก — พยายามใช้ type "adjust" ก่อน ถ้า DB ไม่รองรับจะ fallback เป็น in/out
  const logAdjustTx = async ({ productId, delta, note, by }) => {
    const base = { product_id: productId, date: new Date().toISOString().split("T")[0], note, by: by || "ระบบ" };
    try {
      const [tx] = await api.addTransaction({ ...base, type: "adjust", quantity: delta });
      return tx;
    } catch {
      const [tx] = await api.addTransaction({ ...base, type: delta >= 0 ? "in" : "out", quantity: Math.abs(delta), note: `[ปรับสต็อก] ${note}` });
      return tx;
    }
  };

  const handleEditProduct = async () => {
    setSaving(true);
    try {
      const before = selectedProduct;
      const oldQ = Number(before.quantity) || 0;
      const newQ = parseInt(form.quantity) || 0;
      const delta = newQ - oldQ;
      // รวบรวมรายการที่ถูกแก้ไข เพื่อใช้เป็นหมายเหตุใน log
      const changes = [];
      if (delta !== 0) changes.push(`สต็อก ${oldQ}→${newQ}`);
      if ((form.name || "") !== (before.name || "")) changes.push("ชื่อ");
      if ((form.sku || "") !== (before.sku || "")) changes.push("SKU");
      if ((parseFloat(form.price) || 0) !== (Number(before.price) || 0)) changes.push(`ราคาทุน→฿${parseFloat(form.price) || 0}`);
      if ((parseInt(form.minStock) || 0) !== (Number(before.minStock) || 0)) changes.push("สต็อกขั้นต่ำ");
      if ((form.unit || "") !== (before.unit || "")) changes.push("หน่วย");
      if ((form.location || "") !== (before.location || "")) changes.push("ที่เก็บ");

      const [updated] = await api.updateProduct(selectedProduct.id, productToDb(form));
      setRawProducts(prev => prev.map(p => p.id === selectedProduct.id ? dbToProduct(updated) : p));

      // บันทึก log เมื่อมีการเปลี่ยนแปลงจริง
      if (changes.length) {
        try {
          const tx = await logAdjustTx({
            productId: selectedProduct.id,
            delta,
            note: `แก้ไขสินค้า: ${changes.join(", ")}`,
            by: form.editBy || "แก้ไขในระบบ",
          });
          if (tx) setTransactions(prev => [dbToTx(tx), ...prev]);
        } catch (logErr) { console.warn("บันทึก log การแก้ไขไม่สำเร็จ:", logErr); }
      }

      setShowModal(null); setForm({}); setSelectedProduct(null);
      showToast("แก้ไขสินค้าสำเร็จ");
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const handleDeleteProduct = async (id) => {
    if (!confirm("ยืนยันลบสินค้านี้?")) return;
    try {
      await api.deleteProduct(id);
      setRawProducts(prev => prev.filter(p => p.id !== id));
      showToast("ลบสินค้าสำเร็จ");
    } catch (e) { showToast(e.message, "error"); }
  };

  const handleTransaction = async () => {
    if (!txForm.productId || !txForm.quantity || !txForm.by) return showToast("กรุณากรอกข้อมูลให้ครบ", "error");
    const qty = parseInt(txForm.quantity);
    const pid = parseInt(txForm.productId);
    const product = products.find(p => p.id === pid);
    // ไม่อนุญาตให้เบิกออกเกินสต็อกที่มี (ห้ามสต็อกติดลบ)
    if (txType === "out" && qty > product.quantity) {
      alert(`ไม่สามารถเบิกออกได้ เพราะสต็อกคงเหลือมีไม่พอ\n\nสินค้า: ${product.name}\nคงเหลือ: ${product.quantity} ${product.unit}\nต้องการเบิก: ${qty} ${product.unit}`);
      return;
    }
    setSaving(true);
    try {
      const newQty = txType === "in" ? product.quantity + qty : product.quantity - qty;
      // ไม่แตะยอด "รอเข้า" ที่นี่ — ยอดจริงอยู่ที่ระบบใบสั่ง จะลดลงเมื่อพนักงานติ๊กรับในหน้าสินค้ารอสั่ง
      await api.updateProduct(pid, { quantity: newQty });
      const [newTx] = await api.addTransaction({ type: txType, product_id: pid, quantity: qty, date: new Date().toISOString().split("T")[0], note: txForm.note || null, by: txForm.by });
      setRawProducts(prev => prev.map(p => p.id === pid ? { ...p, quantity: newQty } : p));
      setTransactions(prev => [dbToTx(newTx), ...prev]);
      setTxForm({ productId: "", quantity: "", note: "", by: "" });
      setShowModal(null);
      showToast(txType === "in" ? "รับสินค้าเข้าคลังสำเร็จ" : "เบิกสินค้าออกสำเร็จ");
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  // ── รับเข้าตีกลับ: เลือกหลายสินค้า ใส่จำนวน แล้วบันทึกครั้งเดียว ──
  const openReturnBatchModal = () => {
    setReturnBatchItems([]);
    setReturnBatchSearch("");
    setReturnBatchBy("");
    setReturnBatchIsReturn(false);
    setReturnBatchSelectedIds(new Set());
    setShowReturnBatchModal(true);
  };

  const addToReturnBatch = (product) => {
    setReturnBatchItems(prev => {
      const existing = prev.find(it => it.productId === product.id);
      if (existing) {
        return prev.map(it => it.productId === product.id ? { ...it, quantity: it.quantity + 1 } : it);
      }
      return [...prev, { productId: product.id, name: product.name, sku: product.sku, unit: product.unit, quantity: 1 }];
    });
  };

  const toggleReturnBatchSelect = (productId) => {
    setReturnBatchSelectedIds(prev => {
      const next = new Set(prev);
      next.has(productId) ? next.delete(productId) : next.add(productId);
      return next;
    });
  };

  const addSelectedToReturnBatch = () => {
    returnBatchSelectedIds.forEach(id => {
      const p = products.find(x => x.id === id);
      if (p) addToReturnBatch(p);
    });
    setReturnBatchSelectedIds(new Set());
    setReturnBatchSearch("");
  };

  const updateReturnBatchQty = (productId, qty) => {
    const n = Math.max(0, parseInt(qty) || 0);
    setReturnBatchItems(prev => prev.map(it => it.productId === productId ? { ...it, quantity: n } : it));
  };

  const removeFromReturnBatch = (productId) => {
    setReturnBatchItems(prev => prev.filter(it => it.productId !== productId));
  };

  const handleConfirmReturnBatch = async () => {
    const validItems = returnBatchItems.filter(it => it.quantity > 0);
    if (validItems.length === 0) return showToast("กรุณาเลือกสินค้าและระบุจำนวนอย่างน้อย 1 รายการ", "error");
    if (!returnBatchBy.trim()) return showToast("กรุณากรอกชื่อผู้ดำเนินการ", "error");
    setSavingReturnBatch(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const updatedProducts = [...rawProducts];
      const newTxList = [];
      for (const item of validItems) {
        const idx = updatedProducts.findIndex(p => p.id === item.productId);
        if (idx === -1) continue;
        const newQty = updatedProducts[idx].quantity + item.quantity;
        // 1. เพิ่มยอดสต็อกเข้าคลังอัตโนมัติ
        await api.updateProduct(item.productId, { quantity: newQty });
        updatedProducts[idx] = { ...updatedProducts[idx], quantity: newQty };
        // 2. บันทึกรายการเคลื่อนไหว — ใส่หมายเหตุ "ตีกลับ" อัตโนมัติเฉพาะตอนติ๊กตัวเลือกไว้
        const [newTx] = await api.addTransaction({
          type: "in",
          product_id: item.productId,
          quantity: item.quantity,
          date: today,
          note: returnBatchIsReturn ? "ตีกลับ" : null,
          by: returnBatchBy.trim(),
        });
        newTxList.push(dbToTx(newTx));
      }
      setRawProducts(updatedProducts);
      setTransactions(prev => [...newTxList, ...prev]);
      setShowReturnBatchModal(false);
      setReturnBatchItems([]);
      setReturnBatchBy("");
      showToast(`รับเข้า${returnBatchIsReturn ? "ตีกลับ" : ""}สำเร็จ ${validItems.length} รายการ — เพิ่มสต็อกเรียบร้อย`);
    } catch (e) { showToast(e.message, "error"); }
    setSavingReturnBatch(false);
  };

  // ── เบิกออก: เลือกหลายสินค้า ใส่จำนวน แล้วบันทึกครั้งเดียว ──
  const openOutBatchModal = () => {
    setOutBatchItems([]);
    setOutBatchSearch("");
    setOutBatchBy("");
    setShowOutBatchModal(true);
  };

  const addToOutBatch = (product) => {
    if (product.quantity <= 0) return showToast(`${product.name} ไม่มีสต็อกคงเหลือ`, "error");
    setOutBatchItems(prev => {
      const existing = prev.find(it => it.productId === product.id);
      if (existing) {
        const next = Math.min(existing.quantity + 1, product.quantity);
        return prev.map(it => it.productId === product.id ? { ...it, quantity: next } : it);
      }
      return [...prev, { productId: product.id, name: product.name, sku: product.sku, unit: product.unit, quantity: 1, maxQty: product.quantity }];
    });
  };

  const updateOutBatchQty = (productId, qty) => {
    setOutBatchItems(prev => prev.map(it => {
      if (it.productId !== productId) return it;
      const n = Math.max(0, Math.min(parseInt(qty) || 0, it.maxQty));
      return { ...it, quantity: n };
    }));
  };

  const removeFromOutBatch = (productId) => {
    setOutBatchItems(prev => prev.filter(it => it.productId !== productId));
  };

  const handleConfirmOutBatch = async () => {
    const validItems = outBatchItems.filter(it => it.quantity > 0);
    if (validItems.length === 0) return showToast("กรุณาเลือกสินค้าและระบุจำนวนอย่างน้อย 1 รายการ", "error");
    if (!outBatchBy.trim()) return showToast("กรุณากรอกชื่อผู้ดำเนินการ", "error");
    setSavingOutBatch(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const updatedProducts = [...rawProducts];
      const newTxList = [];
      for (const item of validItems) {
        const idx = updatedProducts.findIndex(p => p.id === item.productId);
        if (idx === -1) continue;
        const newQty = updatedProducts[idx].quantity - item.quantity;
        if (newQty < 0) continue; // กันสต็อกติดลบ
        await api.updateProduct(item.productId, { quantity: newQty });
        updatedProducts[idx] = { ...updatedProducts[idx], quantity: newQty };
        const [newTx] = await api.addTransaction({
          type: "out",
          product_id: item.productId,
          quantity: item.quantity,
          date: today,
          note: null,
          by: outBatchBy.trim(),
        });
        newTxList.push(dbToTx(newTx));
      }
      setRawProducts(updatedProducts);
      setTransactions(prev => [...newTxList, ...prev]);
      setShowOutBatchModal(false);
      setOutBatchItems([]);
      setOutBatchBy("");
      showToast(`เบิกออกสำเร็จ ${validItems.length} รายการ — ตัดสต็อกเรียบร้อย`);
    } catch (e) { showToast(e.message, "error"); }
    setSavingOutBatch(false);
  };

  const openEdit = (product) => {
    setSelectedProduct(product);
    setForm({ ...product, quantity: String(product.quantity), minStock: String(product.minStock), price: String(product.price), editBy: "" });
    setShowModal("edit");
  };

  const handleImageUpload = async (product, file) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      try {
        await api.updateProduct(product.id, { image_url: dataUrl });
        setRawProducts(prev => prev.map(p => p.id === product.id ? { ...p, imageUrl: dataUrl } : p));
        showToast("อัปโหลดรูปสำเร็จ");
      } catch (err) { showToast(err.message, "error"); }
    };
    reader.readAsDataURL(file);
  };

  const statusOf = (p) => p.quantity <= 0 ? "หมด" : (p.minStock > 0 && p.quantity <= p.minStock) ? "ใกล้หมด" : "ปกติ";
  const statusColor = (p) => p.quantity <= 0 ? { bg: "#FEE2E2", fg: "#991B1B" } : (p.minStock > 0 && p.quantity <= p.minStock) ? { bg: "#FEF3C7", fg: "#92400E" } : { bg: "#D1FAE5", fg: "#065F46" };
  const productName = (id) => products.find(p => p.id === id)?.name || `#${id}`;
  const productUnit = (id) => products.find(p => p.id === id)?.unit || "";

  const filteredTx = useMemo(() => {
    let arr = filterProductId ? transactions.filter(tx => tx.productId === filterProductId) : transactions;
    if (txDateFilter.mode !== "all") {
      const { rangeFrom, rangeTo } = txDateFilter;
      arr = arr.filter(tx => (!rangeFrom || tx.date >= rangeFrom) && (!rangeTo || tx.date <= rangeTo));
    }
    return arr;
  }, [transactions, filterProductId, txDateFilter.mode, txDateFilter.rangeFrom, txDateFilter.rangeTo]);

  const handleExportTx = async () => {
    setExportingTx(true);
    try {
      const XLSX = await loadXLSX();
      const HEADER = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1A3C5E" } } };
      const rangeLabel = txDateFilter.mode === "all" ? "ทั้งหมด"
        : `${txDateFilter.rangeFrom || "-"} ถึง ${txDateFilter.rangeTo || "-"}`;
      const ws = XLSX.utils.aoa_to_sheet([
        [{ v: "รายการเคลื่อนไหว N2P", s: { font: { bold: true, sz: 14 } } }],
        ["ช่วงเวลา", rangeLabel],
        ["วันที่ออกรายงาน", new Date().toLocaleDateString("th-TH", { dateStyle: "long" })],
        [""],
        [
          { v: "ประเภท", s: HEADER }, { v: "SKU", s: HEADER }, { v: "สินค้า", s: HEADER },
          { v: "จำนวน", s: HEADER }, { v: "หน่วย", s: HEADER }, { v: "วันที่", s: HEADER }, { v: "ผู้ทำรายการ", s: HEADER }, { v: "หมายเหตุ", s: HEADER },
        ],
        ...filteredTx.map(tx => {
          const p = products.find(x => x.id === tx.productId);
          const v = txView(tx, productUnit(tx.productId));
          const signedQty = tx.type === "out" ? -tx.quantity : tx.quantity; // "in"/"adjust" เก็บค่าที่มีเครื่องหมายอยู่แล้ว, "out" เก็บเป็นค่าบวกจึงต้องใส่ลบเพื่อให้ sum ได้ถูกต้อง
          return [v.label, p?.sku || "-", productName(tx.productId), { v: signedQty }, productUnit(tx.productId), tx.date, tx.by || "-", tx.note || "-"];
        }),
        [""],
        [{ v: "รวม", s: { font: { bold: true } } }, "", "",
         { v: filteredTx.reduce((s, tx) => s + (tx.type === "out" ? -tx.quantity : tx.quantity), 0), s: { font: { bold: true } } }],
      ]);
      ws["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 30 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "รายการเคลื่อนไหว");
      const suffix = txDateFilter.mode === "all" ? "" : `_${txDateFilter.rangeFrom || ""}_${txDateFilter.rangeTo || ""}`;
      XLSX.writeFile(wb, `transactions${suffix}_${todayStr()}.xlsx`);
    } catch (e) { showToast("Export ไม่สำเร็จ: " + e.message, "error"); }
    setExportingTx(false);
  };

  // รายการที่นับจริงต่างจากระบบ (ใช้แสดงจำนวนและปุ่มบันทึกในโหมดเช็ค/ปรับสต็อก)
  const stockCheckDiffs = Object.entries(stockCounts)
    .map(([pid, v]) => {
      const counted = parseInt(v);
      const prod = products.find(x => x.id === parseInt(pid));
      if (!prod || v === "" || !Number.isFinite(counted)) return null;
      return { prod, counted, delta: counted - prod.quantity };
    })
    .filter(x => x && x.delta !== 0);

  const handleConfirmStockCheck = async () => {
    if (stockCheckDiffs.length === 0) return showToast("ไม่มีรายการที่ต้องปรับ", "error");
    if (!confirm(`ยืนยันปรับสต็อก ${stockCheckDiffs.length} รายการให้ตรงกับที่นับจริง?`)) return;
    setSavingStockCheck(true);
    try {
      const newTxs = [];
      for (const d of stockCheckDiffs) {
        await api.updateProduct(d.prod.id, { quantity: d.counted });
        const tx = await logAdjustTx({
          productId: d.prod.id,
          delta: d.delta,
          note: `เช็คสต็อก: ระบบ ${d.prod.quantity} → นับจริง ${d.counted}`,
          by: checkerName || "ตรวจนับ",
        });
        if (tx) newTxs.push(dbToTx(tx));
        setRawProducts(prev => prev.map(p => p.id === d.prod.id ? { ...p, quantity: d.counted } : p));
      }
      setTransactions(prev => [...newTxs.reverse(), ...prev]);
      setStockCounts({}); setCheckerName(""); setStockCheckMode(false);
      showToast(`ปรับสต็อก ${stockCheckDiffs.length} รายการสำเร็จ`);
    } catch (e) { showToast(e.message, "error"); }
    setSavingStockCheck(false);
  };

  const filteredDisposeRecords = disposeRecords.filter(r =>
    !disposeSearch.trim() ||
    (r.name || "").toLowerCase().includes(disposeSearch.trim().toLowerCase()) ||
    (r.sku || "").toLowerCase().includes(disposeSearch.trim().toLowerCase()) ||
    (r.disposed_by || "").toLowerCase().includes(disposeSearch.trim().toLowerCase())
  );

  // วันที่ใช้เทียบกับตัดสต็อก — ใช้ effective_date ถ้าแอดมินย้ายวันไว้ ไม่งั้น fallback ไปวันที่ส่งจริง (created_at)
  const scanEffectiveDate = (s) => s.effective_date || (s.created_at ? localDateStr(new Date(s.created_at)) : null);

  const scanInDateRange = (s) => {
    const date = scanEffectiveDate(s);
    if (!date) return false;
    return (!scanDateFrom || date >= scanDateFrom) && (!scanDateTo || date <= scanDateTo);
  };

  const filteredOrderScans = orderScans.filter(s => {
    if (!scanInDateRange(s)) return false;
    const q = orderScanSearch.trim().toLowerCase();
    if (!q) return true;
    if ((s.page_name || "").toLowerCase().includes(q)) return true;
    const products = Array.isArray(s.products) ? s.products : [];
    return products.some(p => (p.name || "").toLowerCase().includes(q));
  });
  const unreviewedScanCount = orderScans.filter(s => !s.reviewed).length;

  // ── สรุปรายวัน: ยอดตัดสต็อกจริง (master stock) VS ยอดจาก extension เพื่อชนกัน ──
  const dailyStockOutByDate = useMemo(() => {
    const map = {};
    transactions.forEach(tx => {
      if (tx.type !== "out" || !tx.date) return;
      if (!map[tx.date]) map[tx.date] = { totalQty: 0, byProduct: {} };
      map[tx.date].totalQty += tx.quantity;
      const name = productName(tx.productId);
      map[tx.date].byProduct[name] = (map[tx.date].byProduct[name] || 0) + tx.quantity;
    });
    return map;
  }, [transactions, products]);

  const dailyScanByDate = useMemo(() => {
    const map = {};
    orderScans.forEach(s => {
      const date = scanEffectiveDate(s);
      if (!date) return;
      if (!map[date]) map[date] = { totalOrders: 0, totalItems: 0, scanCount: 0, byProduct: {}, notes: [] };
      map[date].totalOrders += s.total_orders || 0;
      map[date].scanCount += 1;
      const prods = Array.isArray(s.products) ? s.products : [];
      if (prods.length === 0) map[date].totalItems += s.total_items || 0;
      prods.forEach(p => {
        const q = Number(p.qty) || 0;
        // จับคู่ชื่อโปร (เช่น "6 แพค ฟรี 1 แพค") → SKU × ชิ้น ด้วยตารางเดียวกับหน้ายิงตัดสต๊อก; ไม่มี alias → นับตามชื่อเดิม 1 หน่วย = 1 ชิ้น
        const comps = aliasMap.get(pickName(p.name));
        if (comps === undefined) { map[date].byProduct[p.name] = (map[date].byProduct[p.name] || 0) + q; map[date].totalItems += q; return; }
        comps.forEach(c => { const nm = productName(c.product_id); const pieces = q * c.qty; map[date].byProduct[nm] = (map[date].byProduct[nm] || 0) + pieces; map[date].totalItems += pieces; });
      });
      if (s.note && s.note.trim()) {
        map[date].notes.push({
          time: new Date(s.created_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }),
          pageName: s.page_name || "ไม่ระบุ",
          note: s.note.trim(),
        });
      }
    });
    return map;
  }, [orderScans, aliasMap, products]);

  const comparisonDates = useMemo(() => {
    const inRange = (d) => (!scanDateFrom || d >= scanDateFrom) && (!scanDateTo || d <= scanDateTo);
    const set = new Set([...Object.keys(dailyStockOutByDate), ...Object.keys(dailyScanByDate)].filter(inRange));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [dailyStockOutByDate, dailyScanByDate, scanDateFrom, scanDateTo]);

  const appStyles = `
    @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Sarabun', sans-serif; }
    .inp { width: 100%; background: #F9FAFB; border: 1.5px solid #E5E7EB; border-radius: 10px; padding: 10px 14px; color: #111827; font-size: 14px; outline: none; font-family: 'Sarabun', sans-serif; }
    .inp:focus { border-color: #7C3AED; }
    table { width: 100%; border-collapse: collapse; font-family: 'Sarabun', sans-serif; }
    thead th { background: linear-gradient(135deg,#7C3AED,#3B82F6); color: rgba(255,255,255,0.88); font-size: 12px; font-weight: 600; text-align: left; padding: 10px 12px; white-space: nowrap; }
    tbody td { padding: 9px 12px; border-bottom: 1px solid #F3F4F6; font-size: 13px; color: #374151; vertical-align: middle; }
    tbody tr:hover { background: #FAFAFE; }
    button { font-family: 'Sarabun', sans-serif; }
    .backlog-note-cols { column-count: 2; column-gap: 24px; }
    .backlog-note-cols > div { break-inside: avoid; }
    @media (max-width: 700px) { .backlog-note-cols { column-count: 1; } }
  `;

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Sarabun', sans-serif", color: "#6B7280" }}>
      <style>{appStyles}</style>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
        กำลังโหลดข้อมูลคลังสินค้า...
      </div>
    </div>
  );

  if (dbError) return (
    <div style={{ minHeight: "100vh", background: "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Sarabun', sans-serif", padding: 20 }}>
      <style>{appStyles}</style>
      <div style={{ background: "#fff", border: "1.5px solid #FECACA", borderRadius: 16, padding: 28, maxWidth: 480, textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>⚠️</div>
        <div style={{ fontWeight: 700, color: "#991B1B", marginBottom: 6 }}>เชื่อมต่อฐานข้อมูลไม่สำเร็จ</div>
        <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 18 }}>{dbError}</div>
        <button onClick={loadAll} style={{ background: "linear-gradient(135deg,#7C3AED,#3B82F6)", color: "#fff", border: "none", borderRadius: 10, padding: "10px 24px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>ลองใหม่</button>
      </div>
    </div>
  );

  // ── เมนูย่อยของแท็บ "เช็คสต็อก" ── (พิมพ์ใบเช็คสต็อกเป็นคำสั่ง ไม่ใช่หน้า จึงสั่งพิมพ์เลยไม่เปลี่ยนหน้า)
  const goStockSub = (v) => {
    if (v === "print") { handlePrintStockSheet(); return; }
    setStockSub(v);
    setStockCounts({});
    setSelectedForDispose(new Set());
  };
  const stockSubTabs = tab === "stockcheck" ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, width: 200, flexShrink: 0 }}>
      {[["orders", "🧾 เช็คออเดอร์"], ["adjust", "🔍 ปรับสต็อก"], ["receivingApproval", "📥 รับเข้ารออนุมัติ"], ["reorder", "🛒 ต้องสั่งซื้อ"], ["dispose", "🗑️ จำหน่ายออก"], ["labels", "🏷️ แผ่นบาร์โค้ด"], ["transactions", "🔄 เคลื่อนไหว"], ["print", "🖨️ พิมพ์ใบเช็คสต็อก"]].map(([v, l]) => {
        const on = v !== "print" && stockSub === v;
        const badgeCount = v === "orders" ? unreviewedScanCount : v === "reorder" ? reorderList.length : 0;
        return (
          <button key={v} onClick={() => goStockSub(v)}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left", background: on ? "#7C3AED" : "#fff", color: on ? "#fff" : "#6B7280", border: "1px solid " + (on ? "#7C3AED" : "#E5E7EB"), borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: on ? 700 : 500, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>
            <span>{l}</span>{badgeCount > 0 ? <span style={{ background: on ? "rgba(255,255,255,.25)" : "#FEE2E2", color: on ? "#fff" : "#DC2626", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>{badgeCount}</span> : null}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div style={{ minHeight: "100vh", background: "#F3F4F6", fontFamily: "'Sarabun', sans-serif", paddingBottom: 60 }}>
      <style>{appStyles}</style>

      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #E5E7EB", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "linear-gradient(135deg,#7C3AED,#3B82F6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19 }}>📦</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 17, color: "#111827" }}>StockMaster</div>
              <div style={{ fontSize: 11, color: "#9CA3AF" }}>ระบบจัดการคลังสินค้า N2P</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[["dashboard","🏠 แดชบอร์ด"],["backlog","📋 บันทึกค้างส่ง"],["pick","🎯 ยิงตัดสต๊อก"],["receiving","📥 รับสินค้าเข้า"],["inventory","📦 คลังสินค้า"],["returns","📮 พัสดุตีกลับ"],["stockcheck","🔍 เช็คสต็อก"]].map(([v,l]) => {
              const badgeCount = v === "stockcheck" ? unreviewedScanCount + reorderList.length : 0;
              return (
              <button key={v} onClick={() => setTab(v)}
                style={{ background: tab === v ? "linear-gradient(135deg,#7C3AED,#3B82F6)" : badgeCount > 0 ? "#FEF2F2" : "transparent", color: tab === v ? "#fff" : badgeCount > 0 ? "#DC2626" : "#6B7280", border: "none", borderRadius: 10, padding: "8px 14px", fontSize: 13, fontWeight: tab === v || badgeCount > 0 ? 700 : 400, cursor: "pointer", transition: "all 0.2s" }}>
                {l}{badgeCount > 0 ? ` (${badgeCount})` : ""}
              </button>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 20px" }}>

        {/* ─── ยิงตัดสต๊อกจากใบหยิบ ─── */}
        {tab === "pick" && (
          <PickScanPanel products={products} aliases={aliasMap} onAliasesChange={setAliasMap} showToast={showToast} onStockCut={applyPickCut} onAddProduct={openAddProductNamed} />
        )}

        {/* ─── รับสินค้าเข้า (แทนใบพิมพ์กระดาษ) — ไม่ล็อกรหัส ─── */}
        {tab === "receiving" && (
          <ReceivingPanel products={products} backlog={backlog} incomingAlias={incomingAlias} onReceivingLogChange={upsertReceivingLogs} showToast={showToast} />
        )}

        {/* ─── บันทึกค้างส่ง — ย้ายออกมาเป็นแท็บหลัก ไม่ล็อกรหัสผู้จัดการอีกต่อไป ─── */}
        {tab === "backlog" && (
          <BacklogNotesPanel products={products} showToast={showToast} onViewHistory={setHistoryProduct} />
        )}

        {/* ─── DASHBOARD ─── */}
        {tab === "dashboard" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, marginBottom: 24 }}>
              {[
                { label: "จำนวนสินค้า (SKU)", value: products.length, icon: "📦", bg: "#F5F3FF", color: "#7C3AED" },
                { label: "ชิ้นรวมทั้งคลัง", value: totalItems.toLocaleString("th-TH"), icon: "🧮", bg: "#EFF6FF", color: "#2563EB" },
                { label: "มูลค่ารวม (฿)", value: totalValue.toLocaleString("th-TH"), icon: "💰", bg: "#F0FDF4", color: "#059669" },
                { label: "ใกล้หมด/หมด", value: lowStock.length, icon: "⚠️", bg: lowStock.length > 0 ? "#FEF2F2" : "#F0FDF4", color: lowStock.length > 0 ? "#DC2626" : "#059669" },
                { label: "ไม่เคลื่อนไหว 15 วัน", value: dormantProducts.length, icon: "😴", bg: "#F9FAFB", color: "#6B7280" },
              ].map((s, i) => (
                <div key={i} style={{ background: "#fff", borderRadius: 16, padding: 18, border: "1px solid #E5E7EB" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: s.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, marginBottom: 10 }}>{s.icon}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 12, color: "#6B7280", marginTop: 3 }}>{s.label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {/* สินค้าใกล้หมด */}
              <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: 18 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#111827", marginBottom: 12 }}>⚠️ สินค้าใกล้หมด / หมดสต็อก ({lowStock.length})</div>
                <div style={{ maxHeight: 340, overflowY: "auto" }}>
                  {lowStock.length === 0 && <div style={{ color: "#9CA3AF", fontSize: 13, textAlign: "center", padding: 20 }}>ไม่มีสินค้าใกล้หมด 🎉</div>}
                  {lowStock.map(p => (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #F3F4F6" }}>
                      <div>
                        <div style={{ fontSize: 13, color: "#111827" }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: "#9CA3AF", fontFamily: "monospace" }}>{p.sku}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ background: statusColor(p).bg, color: statusColor(p).fg, borderRadius: 6, padding: "2px 10px", fontSize: 12, fontWeight: 700 }}>{p.quantity} {p.unit}</span>
                        <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 2 }}>ขั้นต่ำ {p.minStock}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ไม่เคลื่อนไหว 15 วัน */}
              <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>😴 ไม่เคลื่อนไหว 15 วัน ({dormantProducts.length})</div>
                  {dormantProducts.length > 6 && (
                    <button onClick={() => setShowAllDormant(v => !v)}
                      style={{ background: "none", border: "none", color: "#7C3AED", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                      {showAllDormant ? "ย่อ" : "ดูทั้งหมด"}
                    </button>
                  )}
                </div>
                <div style={{ maxHeight: 340, overflowY: "auto" }}>
                  {dormantProducts.length === 0 && <div style={{ color: "#9CA3AF", fontSize: 13, textAlign: "center", padding: 20 }}>สินค้าทุกตัวมีการเคลื่อนไหว 👍</div>}
                  {(showAllDormant ? dormantProducts : dormantProducts.slice(0, 6)).map(p => (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #F3F4F6" }}>
                      <div>
                        <div style={{ fontSize: 13, color: "#111827" }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: "#9CA3AF", fontFamily: "monospace" }}>{p.sku}</div>
                      </div>
                      <span style={{ fontSize: 12, color: "#6B7280" }}>{p.quantity} {p.unit}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* การเคลื่อนไหวล่าสุด */}
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: 18, marginTop: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#111827", marginBottom: 12 }}>🕘 การเคลื่อนไหวล่าสุด</div>
              {transactions.slice(0, 8).map(tx => (
                <div key={tx.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #F3F4F6", fontSize: 13 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 15 }}>{tx.type === "in" ? "📥" : tx.type === "adjust" ? "⚖️" : "📤"}</span>
                    <div>
                      <div style={{ color: "#111827" }}>{productName(tx.productId)}</div>
                      <div style={{ fontSize: 11, color: "#9CA3AF" }}>{tx.date} · โดย {tx.by || "-"}{tx.note ? ` · ${tx.note}` : ""}</div>
                    </div>
                  </div>
                  <span style={{ fontWeight: 700, color: txView(tx).color }}>{txView(tx, productUnit(tx.productId)).amount}</span>
                </div>
              ))}
              {transactions.length === 0 && <div style={{ color: "#9CA3AF", fontSize: 13, textAlign: "center", padding: 20 }}>ยังไม่มีรายการเคลื่อนไหว</div>}
            </div>
          </div>
        )}

        {/* ─── INVENTORY ─── */}
        {(tab === "inventory" || (tab === "stockcheck" && scansUnlocked && (stockSub === "adjust" || (stockSub === "dispose" && disposeMode)))) && (
          <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
            {stockSubTabs}
            <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 4 }}>{tab === "stockcheck" ? (stockSub === "adjust" ? "🔍 ปรับสต็อก" : "🗑️ จำหน่ายออก") : "📦 คลังสินค้า"}</h2>
                <p style={{ fontSize: 13, color: "#6B7280" }}>{filteredProducts.length} รายการ · มูลค่ารวม ฿{totalValue.toLocaleString("th-TH")}</p>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {!disposeMode && tab === "inventory" && (
                  <>
                    <button onClick={handleExportInventory} disabled={exportingInventory}
                      style={{ background: "#EDE9FE", color: "#7C3AED", border: "1px solid #DDD6FE", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      {exportingInventory ? "⏳..." : "📥 Export Excel"}
                    </button>
                    <button onClick={() => setShowIncomingModal(true)}
                      title="ของที่สั่งแล้วรอเข้า ดึงจากระบบใบสั่ง แล้วจับคู่ชื่อกับสินค้าในคลังให้อัตโนมัติ"
                      style={{ background: incomingUnmatched.length > 0 ? "#FEF3C7" : "#F5F3FF", color: incomingUnmatched.length > 0 ? "#B45309" : "#7C3AED", border: `1px solid ${incomingUnmatched.length > 0 ? "#FDE68A" : "#DDD6FE"}`, borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      🧾 ของรอเข้า{incomingUnmatched.length > 0 ? ` · ${incomingUnmatched.length} ยังไม่จับคู่` : ""}
                    </button>
                    <button onClick={() => { setForm({}); setShowModal("add"); }}
                      style={{ background: "linear-gradient(135deg,#7C3AED,#3B82F6)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                      ＋ เพิ่มสินค้า
                    </button>
                  </>
                )}
                {tab === "stockcheck" && stockSub === "adjust" && (
                  <>
                    <button onClick={openReturnBatchModal}
                      style={{ background: "#FFF7ED", color: "#C2410C", border: "1px solid #FED7AA", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                      📦 รับเข้าหลายรายการ
                    </button>
                    <button onClick={openOutBatchModal}
                      style={{ background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                      📤 เบิกออก (หลายรายการ)
                    </button>
                  </>
                )}
                {disposeMode && (
                  <>
                    <span style={{ alignSelf: "center", fontSize: 13, color: "#DC2626", fontWeight: 700 }}>เลือกแล้ว {selectedForDispose.size} รายการ</span>
                    <button onClick={handleExportDispose} disabled={selectedForDispose.size === 0}
                      style={{ background: "#FFF7ED", color: "#C2410C", border: "1px solid #FED7AA", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: selectedForDispose.size === 0 ? "not-allowed" : "pointer", opacity: selectedForDispose.size === 0 ? 0.5 : 1 }}>
                      📥 Export รายการที่เลือก
                    </button>
                    <button onClick={handleConfirmDispose} disabled={selectedForDispose.size === 0}
                      style={{ background: "#DC2626", color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: selectedForDispose.size === 0 ? "not-allowed" : "pointer", opacity: selectedForDispose.size === 0 ? 0.5 : 1 }}>
                      ✅ ยืนยันจำหน่ายออก
                    </button>
                    <button onClick={() => { setSelectedForDispose(new Set()); setDisposeMode(false); }}
                      style={{ background: "#F9FAFB", color: "#6B7280", border: "1px solid #E5E7EB", borderRadius: 10, padding: "9px 16px", fontSize: 13, cursor: "pointer" }}>
                      ยกเลิก
                    </button>
                  </>
                )}
              </div>
            </div>

            {stockCheckMode && (
              <div style={{ background: "#FFFBEB", border: "1.5px solid #FDE68A", borderRadius: 14, padding: "14px 18px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, color: "#B45309", fontSize: 15 }}>🔍 โหมดเช็ค/ปรับสต็อก</div>
                  <div style={{ fontSize: 13, color: "#92400E", marginTop: 3 }}>
                    กรอกจำนวน "นับจริง" ในตาราง ระบบจะปรับสต็อกให้ตรง — พบส่วนต่าง <span style={{ fontWeight: 700 }}>{stockCheckDiffs.length}</span> รายการ
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <input className="inp" style={{ width: 160 }} placeholder="ผู้ตรวจนับ" value={checkerName} onChange={e => setCheckerName(e.target.value)} />
                  <button onClick={() => setStockCounts({})}
                    style={{ background: "#fff", border: "1px solid #FDE68A", color: "#B45309", borderRadius: 10, padding: "9px 16px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
                    ล้างค่าที่กรอก
                  </button>
                  <button onClick={handleConfirmStockCheck} disabled={savingStockCheck || stockCheckDiffs.length === 0}
                    style={{ background: stockCheckDiffs.length > 0 ? "#D97706" : "#F3F4F6", color: stockCheckDiffs.length > 0 ? "#fff" : "#9CA3AF", border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: stockCheckDiffs.length > 0 ? "pointer" : "not-allowed" }}>
                    {savingStockCheck ? "⏳ กำลังบันทึก..." : `✓ บันทึกการปรับสต็อก (${stockCheckDiffs.length})`}
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
              <input className="inp" style={{ flex: 1, minWidth: 220 }} placeholder="🔍 ค้นหาชื่อสินค้า / SKU..."
                value={search} onChange={e => setSearch(e.target.value)} />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["ทั้งหมด","ปกติ","ใกล้หมด","หมด","ไม่เคลื่อนไหว"].map(s => (
                  <button key={s} onClick={() => setStatusFilter(s)}
                    style={{ background: statusFilter === s ? "linear-gradient(135deg,#7C3AED,#3B82F6)" : "#fff", color: statusFilter === s ? "#fff" : "#6B7280", border: statusFilter === s ? "none" : "1px solid #E5E7EB", borderRadius: 10, padding: "8px 14px", fontSize: 12, fontWeight: statusFilter === s ? 700 : 400, cursor: "pointer" }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, overflow: "hidden", overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    {disposeMode && <th style={{ width: 40 }}>เลือก</th>}
                    <th style={{ width: 46 }}>รูป</th>
                    <SortTh col="sku" label="SKU" />
                    <SortTh col="name" label="ชื่อสินค้า" />
                    <SortTh col="quantity" label="คงเหลือ" />
                    <SortTh col="qtyOnOrder" label="รอเข้า" />
                    <SortTh col="backlogTotal" label="ค้างส่ง" />
                    {stockCheckMode && <th style={{ color: "#FDE68A" }}>นับจริง</th>}
                    <th>หน่วย</th>
                    <SortTh col="minStock" label="ขั้นต่ำ" />
                    <SortTh col="price" label="ราคาทุน (฿)" />
                    <th>มูลค่า (฿)</th>
                    <th>สถานะ</th>
                    <th style={{ textAlign: "right" }}>จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map(p => {
                    const pinned = pinnedIds.includes(String(p.id));
                    const clearance = clearanceIds.includes(String(p.id));
                    const sel = selectedForDispose.has(p.id);
                    return (
                      <tr key={p.id} style={{ background: sel ? "#FEF2F2" : clearance ? "#F5F3FF" : pinned ? "#FFFBEB" : "transparent" }}>
                        {disposeMode && (
                          <td>
                            <input type="checkbox" checked={sel} onChange={() => toggleDispose(p.id)} style={{ width: 16, height: 16, cursor: "pointer" }} />
                          </td>
                        )}
                        <td>
                          <label style={{ cursor: "pointer" }} title="คลิกเพื่ออัปโหลดรูป">
                            {p.imageUrl
                              ? <img src={p.imageUrl} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: "cover", border: "1px solid #E5E7EB" }} />
                              : <div style={{ width: 34, height: 34, borderRadius: 8, background: "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🖼️</div>}
                            <input type="file" accept="image/*" style={{ display: "none" }}
                              onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(p, f); e.target.value = ""; }} />
                          </label>
                        </td>
                        <td style={{ fontFamily: "monospace", fontSize: 12, whiteSpace: "nowrap" }}>{p.sku}</td>
                        <td>
                          <span onClick={() => togglePin(p.id)} title={pinned ? "เลิกปักหมุด" : "ปักหมุด"}
                            style={{ cursor: "pointer", marginRight: 4, opacity: pinned ? 1 : 0.3 }}>📌</span>
                          <span onClick={() => toggleClearance(p.id)} title={clearance ? "เลิกเป็นสินค้าเคลียร์สต็อก" : "ตั้งเป็นสินค้าเคลียร์สต็อก"}
                            style={{ cursor: "pointer", marginRight: 6, opacity: clearance ? 1 : 0.3 }}>🏷️</span>
                          {p.name}
                        </td>
                        <td style={{ fontWeight: 700, color: statusColor(p).fg }}>{p.quantity}</td>
                        <td style={{ color: p.qtyOnOrder > 0 ? "#7C3AED" : "#D1D5DB", fontWeight: p.qtyOnOrder > 0 ? 700 : 400, whiteSpace: "nowrap" }}
                                title={p.incomingSources ? "จากระบบใบสั่ง:\n" + p.incomingSources.map(x => "• " + x.name + " — " + x.qty).join("\n") : undefined}>
                                {p.qtyOnOrder > 0 ? `+${p.qtyOnOrder}` : "-"}
                                {p.incomingSources && <span style={{ marginLeft: 3, fontSize: 10, opacity: 0.65 }}>🧾</span>}
                              </td>
                        <td style={{ color: p.backlogTotal > 0 ? "#B45309" : "#D1D5DB", fontWeight: p.backlogTotal > 0 ? 700 : 400, whiteSpace: "nowrap" }}
                          title={p.backlogTotal > 0 ? `ค้างส่งจากบันทึกค้างส่งใน StockMaster (MyOrder):\nจำนวน: ${p.backlogTotal} ชิ้น${p.backlogNote ? `\nหมายเหตุ: ${p.backlogNote}` : ""}${backlogNotes?.saved_at ? `\nบันทึกล่าสุด: ${fmtDT(backlogNotes.saved_at)}` : ""}` : undefined}>
                          {p.backlogTotal > 0 ? p.backlogTotal : "-"}
                          {p.backlogTotal > 0 && <span style={{ marginLeft: 3, fontSize: 10, opacity: 0.65 }}>📋</span>}
                        </td>
                        {stockCheckMode && (() => {
                          const raw = stockCounts[p.id] ?? "";
                          const counted = parseInt(raw);
                          const hasVal = raw !== "" && Number.isFinite(counted);
                          const delta = hasVal ? counted - p.quantity : 0;
                          return (
                            <td>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <input type="number" className="inp" style={{ width: 78, padding: "5px 8px", borderColor: hasVal && delta !== 0 ? "#D97706" : undefined }}
                                  placeholder={String(p.quantity)} value={raw}
                                  onChange={e => setStockCounts(prev => ({ ...prev, [p.id]: e.target.value }))} />
                                {hasVal && delta !== 0 && (
                                  <span style={{ fontSize: 12, fontWeight: 700, color: delta > 0 ? "#059669" : "#DC2626", whiteSpace: "nowrap" }}>
                                    {delta > 0 ? "+" : "−"}{Math.abs(delta)}
                                  </span>
                                )}
                                {hasVal && delta === 0 && <span style={{ fontSize: 12, color: "#059669" }}>✓</span>}
                              </div>
                            </td>
                          );
                        })()}
                        <td>{p.unit}</td>
                        <td style={{ color: "#9CA3AF" }}>{p.minStock || "-"}</td>
                        <td style={{ fontFamily: "monospace", fontSize: 12 }}>{p.price.toLocaleString("th-TH")}</td>
                        <td style={{ fontFamily: "monospace", fontSize: 12 }}>{(Math.max(0, p.quantity) * p.price).toLocaleString("th-TH")}</td>
                        <td>
                          <span style={{ background: statusColor(p).bg, color: statusColor(p).fg, borderRadius: 6, padding: "2px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{statusOf(p)}</span>
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <button onClick={() => { setTxType("in"); setTxForm({ productId: String(p.id), quantity: "", note: "", by: "" }); setShowModal("tx"); }}
                            title="รับเข้า" style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", color: "#059669", borderRadius: 8, padding: "4px 9px", fontSize: 12, cursor: "pointer", marginRight: 4, fontWeight: 700 }}>📥</button>
                          <button onClick={() => { setTxType("out"); setTxForm({ productId: String(p.id), quantity: "", note: "", by: "" }); setShowModal("tx"); }}
                            title="เบิกออก" style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626", borderRadius: 8, padding: "4px 9px", fontSize: 12, cursor: "pointer", marginRight: 4, fontWeight: 700 }}>📤</button>
                          <button onClick={() => setHistoryProduct(p)}
                            title="ดูประวัติ" style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", color: "#6B7280", borderRadius: 8, padding: "4px 9px", fontSize: 12, cursor: "pointer", marginRight: 4 }}>🕘</button>
                          <button onClick={() => openEdit(p)}
                            title="แก้ไข" style={{ background: "#F5F3FF", border: "1px solid #DDD6FE", color: "#7C3AED", borderRadius: 8, padding: "4px 9px", fontSize: 12, cursor: "pointer", marginRight: 4 }}>✏️</button>
                          <button onClick={() => handleDeleteProduct(p.id)}
                            title="ลบ" style={{ background: "none", border: "none", color: "#D1D5DB", fontSize: 13, cursor: "pointer" }}
                            onMouseEnter={e => e.target.style.color = "#EF4444"} onMouseLeave={e => e.target.style.color = "#D1D5DB"}>✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredProducts.length === 0 && (
                <div style={{ textAlign: "center", padding: 48, color: "#9CA3AF" }}>ไม่พบสินค้า — ลองเปลี่ยนคำค้นหรือตัวกรอง</div>
              )}
            </div>
            </div>
          </div>
        )}

        {/* ─── ต้องสั่งซื้อ ─── */}
        {tab === "stockcheck" && scansUnlocked && stockSub === "reorder" && (
          <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
            {stockSubTabs}
            <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 4 }}>🛒 ต้องสั่งซื้อ</h2>
                <p style={{ fontSize: 13, color: "#6B7280" }}>คำนวณจากอัตราเบิกจริง 30 วันล่าสุด หักลบ "รอเข้า" ที่สั่งไว้แล้วออกให้อัตโนมัติ</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ fontSize: 13, color: "#6B7280" }}>ให้สต็อกพอสำหรับ</label>
                <input type="number" min="1" className="inp" style={{ width: 64, padding: "8px 10px", textAlign: "center" }}
                  value={reorderDays} onChange={e => setReorderDays(Math.max(1, parseInt(e.target.value) || 1))} />
                <label style={{ fontSize: 13, color: "#6B7280" }}>วัน</label>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, marginBottom: 20 }}>
              {[
                { label: "รายการที่ต้องสั่ง", value: reorderList.length, icon: "📋", bg: "#F5F3FF", color: "#7C3AED" },
                { label: "หมดสต็อกแล้ว", value: reorderOutOfStock.length, icon: "🚨", bg: reorderOutOfStock.length > 0 ? "#FEF2F2" : "#F0FDF4", color: reorderOutOfStock.length > 0 ? "#DC2626" : "#059669" },
                { label: "ยอดสั่งซื้อประเมิน (฿)", value: reorderCost.toLocaleString("th-TH"), icon: "💰", bg: "#EFF6FF", color: "#2563EB" },
              ].map((s, i) => (
                <div key={i} style={{ background: "#fff", borderRadius: 16, padding: 18, border: "1px solid #E5E7EB" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: s.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{s.icon}</div>
                    <div>
                      <div style={{ fontSize: 12, color: "#6B7280" }}>{s.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ position: "relative", marginBottom: 24, maxWidth: 360 }}>
              <input className="inp" style={{ width: "100%" }} placeholder="🔍 ค้นหาชื่อสินค้า / SKU..."
                value={reorderSearch} onChange={e => setReorderSearch(e.target.value)} />
              {reorderSearch && (
                <button onClick={() => setReorderSearch("")} title="ล้างคำค้นหา"
                  style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#9CA3AF", fontSize: 14, cursor: "pointer" }}>✕</button>
              )}
            </div>

            {/* กลุ่ม 1: หมดสต็อกแล้ว */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                <span style={{ background: "#FEE2E2", color: "#DC2626", borderRadius: 999, padding: "3px 12px", fontSize: 12, fontWeight: 700 }}>ด่วนที่สุด</span>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: 0 }}>หมดสต็อกแล้ว แต่ยังขายได้ต่อเนื่อง</h3>
                <span style={{ fontSize: 12, color: "#6B7280" }}>{reorderSearch ? `${reorderOutOfStockView.length} / ${reorderOutOfStock.length}` : reorderOutOfStock.length} รายการ</span>
              </div>
              <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 10 }}>สินค้ากลุ่มนี้เหลือ 0 ชิ้นในคลัง แต่ยังมีการเบิกออกในช่วงที่ผ่านมา — กำลังเสียโอกาสขายอยู่ตอนนี้ ควรสั่งก่อนกลุ่มอื่นทั้งหมด</p>
              {reorderOutOfStock.length === 0 ? (
                <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, textAlign: "center", padding: 28, color: "#9CA3AF" }}>ไม่มีสินค้าหมดสต็อก 🎉</div>
              ) : reorderOutOfStockView.length === 0 ? (
                <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, textAlign: "center", padding: 28, color: "#9CA3AF" }}>ไม่พบสินค้าที่ค้นหาในกลุ่มนี้</div>
              ) : (
                <ReorderTable list={reorderOutOfStockView} search={reorderSearch} />
              )}
            </div>

            {/* กลุ่ม 2: ใกล้หมด */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                <span style={{ background: "#FEF3C7", color: "#B45309", borderRadius: 999, padding: "3px 12px", fontSize: 12, fontWeight: 700 }}>ใกล้หมด</span>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: 0 }}>จะหมดภายใน {reorderDays} วัน</h3>
                <span style={{ fontSize: 12, color: "#6B7280" }}>{reorderSearch ? `${reorderLowStockView.length} / ${reorderLowStock.length}` : reorderLowStock.length} รายการ</span>
              </div>
              <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 10 }}>ยังมีของอยู่บ้าง แต่ที่อัตราเบิกปัจจุบันจะหมดภายในรอบที่กำหนด ควรสั่งควบคู่ไปกับกลุ่มด่วนที่สุด</p>
              {reorderLowStock.length === 0 ? (
                <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, textAlign: "center", padding: 28, color: "#9CA3AF" }}>ไม่มีสินค้าใกล้หมด 🎉</div>
              ) : reorderLowStockView.length === 0 ? (
                <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, textAlign: "center", padding: 28, color: "#9CA3AF" }}>ไม่พบสินค้าที่ค้นหาในกลุ่มนี้</div>
              ) : (
                <ReorderTable list={reorderLowStockView} search={reorderSearch} />
              )}
            </div>
            </div>
          </div>
        )}

        {/* ─── TRANSACTIONS ─── */}
        {tab === "stockcheck" && scansUnlocked && stockSub === "transactions" && (
          <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
            {stockSubTabs}
            <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 4 }}>🔄 รับเข้า - เบิกออก</h2>
                <p style={{ fontSize: 13, color: "#6B7280" }}>{filteredTx.length} รายการ{filterProductId ? ` · กรอง: ${productName(filterProductId)}` : ""}</p>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {filterProductId && (
                  <button onClick={() => setFilterProductId(null)}
                    style={{ background: "#F9FAFB", color: "#6B7280", border: "1px solid #E5E7EB", borderRadius: 10, padding: "9px 14px", fontSize: 13, cursor: "pointer" }}>
                    ✕ ล้างตัวกรอง
                  </button>
                )}
                <button onClick={openReturnBatchModal}
                  style={{ background: "#FFF7ED", color: "#C2410C", border: "1px solid #FED7AA", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  📦 รับเข้าหลายรายการ
                </button>
                <button onClick={openOutBatchModal}
                  style={{ background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  📤 เบิกออก (หลายรายการ)
                </button>
                <button onClick={handleExportTx} disabled={exportingTx || filteredTx.length === 0}
                  style={{ background: "#EDE9FE", color: "#7C3AED", border: "1px solid #DDD6FE", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: filteredTx.length === 0 ? "not-allowed" : "pointer", opacity: filteredTx.length === 0 ? 0.5 : 1 }}>
                  {exportingTx ? "⏳..." : "📥 Export Excel"}
                </button>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <DateFilterRow filter={txDateFilter} accent="linear-gradient(135deg,#7C3AED,#3B82F6)" />
            </div>

            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, overflow: "hidden", overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>ประเภท</th>
                    <th>สินค้า</th>
                    <th>จำนวน</th>
                    <th>วันที่</th>
                    <th>ผู้ทำรายการ</th>
                    <th>หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTx.map(tx => (
                    <tr key={tx.id}>
                      <td>
                        <span style={{ background: tx.type === "in" ? "#D1FAE5" : tx.type === "adjust" ? "#FEF9C3" : "#FEE2E2", color: tx.type === "in" ? "#065F46" : tx.type === "adjust" ? "#B45309" : "#991B1B", borderRadius: 6, padding: "2px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                          {tx.type === "in" ? "📥 รับเข้า" : tx.type === "adjust" ? "⚖️ ปรับสต็อก" : "📤 เบิกออก"}
                        </span>
                      </td>
                      <td>
                        <span onClick={() => setFilterProductId(tx.productId)} style={{ cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", textDecorationColor: "#C4B5FD" }}>
                          {productName(tx.productId)}
                        </span>
                      </td>
                      <td style={{ fontWeight: 700, color: txView(tx).color }}>{txView(tx, productUnit(tx.productId)).amount}</td>
                      <td style={{ whiteSpace: "nowrap", color: "#6B7280", fontSize: 12 }}>{tx.date}</td>
                      <td>{tx.by || "-"}</td>
                      <td style={{ color: "#6B7280", fontSize: 12 }}>{tx.note || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredTx.length === 0 && (
                <div style={{ textAlign: "center", padding: 48, color: "#9CA3AF" }}>
                  {transactions.length === 0 ? "ยังไม่มีรายการเคลื่อนไหว" : "ไม่พบรายการในช่วงที่เลือก — ลองเปลี่ยนตัวกรองวันที่"}
                </div>
              )}
            </div>
            </div>
          </div>
        )}

        {/* ─── RETURNS ─── */}
        {tab === "returns" && <ReturnCheckerTab />}

        {/* ─── DISPOSE ─── */}
        {tab === "stockcheck" && scansUnlocked && stockSub === "dispose" && !disposeMode && (
          <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
            {stockSubTabs}
            <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 4 }}>🗑️ ประวัติจำหน่ายออก</h2>
                <p style={{ fontSize: 13, color: "#6B7280" }}>รายการสินค้าที่ตัดออกจากระบบ · มูลค่ารวม ฿{disposeRecords.reduce((s, r) => s + Number(r.total_value || 0), 0).toLocaleString("th-TH")}</p>
              </div>
              <button onClick={() => { setDisposeMode(true); setSelectedForDispose(new Set()); }}
                style={{ background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                ＋ จำหน่ายออกเพิ่ม
              </button>
            </div>

            <input className="inp" style={{ marginBottom: 14 }} placeholder="🔍 ค้นหาชื่อสินค้า / SKU / ผู้ทำรายการ..."
              value={disposeSearch} onChange={e => setDisposeSearch(e.target.value)} />

            {loadingDispose && <div style={{ textAlign: "center", padding: 40, color: "#6B7280" }}>กำลังโหลดข้อมูล...</div>}

            {!loadingDispose && (
              <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, overflow: "hidden", overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>วันที่จำหน่ายออก</th>
                      <th>SKU</th>
                      <th>ชื่อสินค้า</th>
                      <th>คงเหลือสุดท้าย</th>
                      <th>ราคาทุน (฿)</th>
                      <th>มูลค่าที่ตัดออก (฿)</th>
                      <th>ผู้ทำรายการ</th>
                      <th>หมายเหตุ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDisposeRecords.map(r => (
                      <tr key={r.id}>
                        <td style={{ whiteSpace: "nowrap", fontSize: 12, color: "#6B7280" }}>{r.disposed_at ? new Date(r.disposed_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "-"}</td>
                        <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.sku}</td>
                        <td>{r.name}</td>
                        <td>{r.final_quantity} {r.unit}</td>
                        <td style={{ fontFamily: "monospace", fontSize: 12 }}>{Number(r.price || 0).toLocaleString("th-TH")}</td>
                        <td style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#DC2626" }}>{Number(r.total_value || 0).toLocaleString("th-TH")}</td>
                        <td>{r.disposed_by || "-"}</td>
                        <td style={{ color: "#6B7280", fontSize: 12 }}>{r.note || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredDisposeRecords.length === 0 && (
                  <div style={{ textAlign: "center", padding: 48, color: "#9CA3AF" }}>
                    {disposeRecords.length === 0 ? "ยังไม่มีประวัติจำหน่ายออก" : "ไม่พบรายการที่ค้นหา"}
                  </div>
                )}
              </div>
            )}
            </div>
          </div>
        )}

        {/* ─── เช็คสต็อกทั้งหมด — เฉพาะผู้จัดการ ต้องปลดล็อกก่อนถึงเห็นเมนูย่อยไหนได้เลย ─── */}
        {tab === "stockcheck" && !scansUnlocked && (
          <div>
            <div style={{ display: "flex", justifyContent: "center", padding: "60px 20px" }}>
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: 32, width: "100%", maxWidth: 340, textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#111827", marginBottom: 4 }}>หน้านี้เฉพาะผู้จัดการ</div>
              <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 16 }}>กรุณากรอกรหัสผ่านเพื่อดูเมนูเช็คสต็อก</div>
              <input className="inp" type="password" inputMode="numeric" placeholder="รหัสผ่าน"
                value={scanPasswordInput}
                onChange={e => { setScanPasswordInput(e.target.value); setScanPasswordError(""); }}
                onKeyDown={e => { if (e.key === "Enter") handleUnlockScans(); }}
                style={{ textAlign: "center", letterSpacing: 4, marginBottom: 8 }} autoFocus />
              {scanPasswordError && <div style={{ color: "#DC2626", fontSize: 12, marginBottom: 8 }}>{scanPasswordError}</div>}
              <button onClick={handleUnlockScans}
                style={{ width: "100%", background: "#7C3AED", color: "#fff", border: "none", borderRadius: 10, padding: "10px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                ปลดล็อก
              </button>
            </div>
            </div>
          </div>
        )}
        {tab === "stockcheck" && scansUnlocked && stockSub === "labels" && (
          <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
            {stockSubTabs}
            <div style={{ flex: 1, minWidth: 0 }}>
            <LabelSheetPanel products={products} />
            </div>
          </div>
        )}
        {tab === "stockcheck" && scansUnlocked && stockSub === "receivingApproval" && (
          <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
            {stockSubTabs}
            <div style={{ flex: 1, minWidth: 0 }}>
            <ReceivingApprovalPanel products={products} onStockChange={applyPickCut} onReceivingLogChange={upsertReceivingLogs} showToast={showToast} />
            </div>
          </div>
        )}
        {tab === "stockcheck" && scansUnlocked && stockSub === "orders" && (
          <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
            {stockSubTabs}
            <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 4 }}>🧾 เช็คออเดอร์ (จาก MyOrder)</h2>
                <p style={{ fontSize: 13, color: "#6B7280" }}>ยอดสรุปสินค้าที่พนักงานติ๊กไว้บน myorder.ai ก่อนแพ็ก — ใช้เทียบกับรายการ "เบิกออก" จริงในระบบ เพื่อตรวจว่าตัดสต็อกตรงกันหรือไม่ · ค้างตรวจ {unreviewedScanCount} รายการ</p>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {[["summary", "📊 สรุปรายวัน"], ["list", "📋 รายการที่ส่งเข้ามา"]].map(([v, l]) => (
                  <button key={v} onClick={() => setOrderScansView(v)}
                    style={{ background: orderScansView === v ? "#7C3AED" : "#F3F4F6", color: orderScansView === v ? "#fff" : "#6B7280", border: "none", borderRadius: 10, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                    {l}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#6B7280" }}>
                <span>ช่วงวันที่:</span>
                <input type="date" className="inp" style={{ padding: "6px 8px", fontSize: 12 }} value={scanDateFrom} onChange={e => setScanDateFrom(e.target.value)} />
                <span>ถึง</span>
                <input type="date" className="inp" style={{ padding: "6px 8px", fontSize: 12 }} value={scanDateTo} onChange={e => setScanDateTo(e.target.value)} />
              </div>
            </div>

            {/* ─── สรุปรายวัน: ตัดสต็อกจริง VS ยอดจาก Extension (เอามาชนกัน) ─── */}
            {orderScansView === "summary" && (
              <div>
                {comparisonDates.length === 0 ? (
                  <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, textAlign: "center", padding: 32, color: "#9CA3AF", fontSize: 13 }}>ไม่มีข้อมูลในช่วงวันที่เลือก</div>
                ) : (
                  <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, overflow: "hidden", overflowX: "auto" }}>
                    <table>
                      <thead>
                        <tr>
                          <th>วันที่</th>
                          <th>ตัดสต็อกจริง (ชิ้น)</th>
                          <th>ยอดจาก Extension (ชิ้น)</th>
                          <th>ส่วนต่าง</th>
                          <th>สถานะ</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparisonDates.map(date => {
                          const stockOut = dailyStockOutByDate[date]?.totalQty || 0;
                          const scanTotal = dailyScanByDate[date]?.totalItems || 0;
                          const scanOrders = dailyScanByDate[date]?.totalOrders || 0;
                          const diff = stockOut - scanTotal;
                          const isOpen = expandedCompareDates.has(date);
                          const hasBoth = !!dailyStockOutByDate[date] && !!dailyScanByDate[date];
                          const ok = hasBoth && diff === 0;
                          const notes = dailyScanByDate[date]?.notes || [];
                          const productNames = Array.from(new Set([
                            ...Object.keys(dailyStockOutByDate[date]?.byProduct || {}),
                            ...Object.keys(dailyScanByDate[date]?.byProduct || {}),
                          ])).sort();
                          return (
                            <Fragment key={date}>
                              <tr onClick={() => toggleCompareDate(date)} style={{ cursor: "pointer" }}>
                                <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{new Date(date).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" })}</td>
                                <td style={{ fontFamily: "monospace" }}>{stockOut.toLocaleString("th-TH")}</td>
                                <td style={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>
                                  {dailyScanByDate[date] ? (
                                    <>
                                      {scanTotal.toLocaleString("th-TH")}
                                      <span style={{ color: "#6B7280", fontSize: 12, marginLeft: 4 }}>({scanOrders.toLocaleString("th-TH")} ออเดอร์)</span>
                                    </>
                                  ) : "-"}
                                </td>
                                <td style={{ fontFamily: "monospace", fontWeight: 700, color: !hasBoth ? "#9CA3AF" : diff === 0 ? "#065F46" : "#DC2626" }}>
                                  {hasBoth ? (diff > 0 ? `+${diff}` : diff) : "-"}
                                </td>
                                <td>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    {!hasBoth ? (
                                      <span style={{ fontSize: 12, background: "#F3F4F6", color: "#6B7280", padding: "3px 9px", borderRadius: 20, fontWeight: 700 }}>
                                        {dailyStockOutByDate[date] ? "ไม่มียอดสแกน" : "ไม่มีการตัดสต็อก"}
                                      </span>
                                    ) : ok ? (
                                      <span style={{ fontSize: 12, background: "#D1FAE5", color: "#065F46", padding: "3px 9px", borderRadius: 20, fontWeight: 700 }}>✅ ตรงกัน</span>
                                    ) : (
                                      <span style={{ fontSize: 12, background: "#FEE2E2", color: "#991B1B", padding: "3px 9px", borderRadius: 20, fontWeight: 700 }}>⚠️ ไม่ตรง</span>
                                    )}
                                    {notes.length > 0 && <span title="มีหมายเหตุ">📝</span>}
                                  </div>
                                </td>
                                <td style={{ color: "#9CA3AF" }}>{isOpen ? "▲" : "▼"}</td>
                              </tr>
                              {isOpen && (
                                <tr>
                                  <td colSpan={6} style={{ background: "#F9FAFB", padding: 0 }}>
                                    <div style={{ padding: "12px 16px" }}>
                                      {notes.length > 0 && (
                                        <div style={{ marginBottom: 12 }}>
                                          <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 }}>📝 หมายเหตุ</div>
                                          <div style={{ display: "grid", gap: 4 }}>
                                            {notes.map((n, i) => (
                                              <div key={i} style={{ fontSize: 12, color: "#92400E", background: "#FEF3C7", padding: "6px 10px", borderRadius: 8 }}>
                                                <b>{n.time} · {n.pageName}:</b> {n.note}
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                      {productNames.length === 0 ? (
                                        <div style={{ fontSize: 12, color: "#9CA3AF" }}>ไม่มีรายละเอียดสินค้า</div>
                                      ) : (
                                        <table>
                                          <thead>
                                            <tr>
                                              <th>สินค้า</th>
                                              <th>ตัดสต็อกจริง</th>
                                              <th>ยอดจาก Extension</th>
                                              <th>ส่วนต่าง</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {productNames.map(name => {
                                              const outQty = dailyStockOutByDate[date]?.byProduct?.[name] || 0;
                                              const scanQty = dailyScanByDate[date]?.byProduct?.[name] || 0;
                                              const pdiff = outQty - scanQty;
                                              return (
                                                <tr key={name}>
                                                  <td>{name}</td>
                                                  <td style={{ fontFamily: "monospace" }}>{outQty}</td>
                                                  <td style={{ fontFamily: "monospace" }}>{scanQty}</td>
                                                  <td style={{ fontFamily: "monospace", fontWeight: 700, color: pdiff === 0 ? "#065F46" : "#DC2626" }}>{pdiff > 0 ? `+${pdiff}` : pdiff}</td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      )}
                                      <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 8 }}>* ชื่อที่จับคู่ไว้ในหน้า "ยิงตัดสต๊อก" (รวมชื่อโปร เช่น 6 ฟรี 1 = 7 ชิ้น) จะถูกแปลงเป็นชื่อสินค้าในคลังและจำนวนชิ้นจริงให้แล้ว ชื่อที่ยังไม่จับคู่จะแสดงตามชื่อเดิม 1 หน่วย = 1 ชิ้น</p>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ─── รายการดิบที่ส่งเข้ามาจาก extension ─── */}
            {orderScansView === "list" && (
              <div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                  <input className="inp" style={{ flex: "1 1 240px" }} placeholder="🔍 ค้นหาชื่อร้าน/เพจ หรือชื่อสินค้า..."
                    value={orderScanSearch} onChange={e => setOrderScanSearch(e.target.value)} />
                  <input className="inp" style={{ flex: "1 1 180px" }} placeholder="ชื่อผู้ตรวจ (กรอกก่อนกดตรวจแล้ว)"
                    value={reviewerName} onChange={e => setReviewerName(e.target.value)} />
                </div>

                {loadingOrderScans && <div style={{ textAlign: "center", padding: 40, color: "#6B7280" }}>กำลังโหลดข้อมูล...</div>}

                {!loadingOrderScans && filteredOrderScans.length === 0 && (
                  <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, textAlign: "center", padding: 48, color: "#9CA3AF" }}>
                    {orderScans.length === 0 ? "ยังไม่มียอดที่ส่งเข้ามาจาก extension" : "ไม่พบรายการในช่วงวันที่/คำค้นหานี้"}
                  </div>
                )}

                {!loadingOrderScans && filteredOrderScans.length > 0 && (
                  <div style={{ display: "grid", gap: 12 }}>
                    {filteredOrderScans.map(s => {
                      const isOpen = expandedScanIds.has(s.id);
                      const products = Array.isArray(s.products) ? s.products : [];
                      const shipEntries = s.ship_summary && typeof s.ship_summary === "object" ? Object.entries(s.ship_summary) : [];
                      const codEntries = s.cod_amount_summary && typeof s.cod_amount_summary === "object" ? Object.entries(s.cod_amount_summary) : [];
                      return (
                        <div key={s.id} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, overflow: "hidden" }}>
                          <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", cursor: "pointer" }}
                            onClick={() => toggleScanExpanded(s.id)}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{s.page_name || "ไม่ระบุร้าน"}</span>
                              <span style={{ fontSize: 12, color: "#9CA3AF" }}>{s.created_at ? new Date(s.created_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "-"}</span>
                              <span style={{ fontSize: 12, background: "#EEF2FF", color: "#4F46E5", padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>{s.total_orders} ออเดอร์</span>
                              <span style={{ fontSize: 12, background: "#EEF2FF", color: "#4F46E5", padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>{s.total_items} ชิ้น</span>
                              {s.note && <span style={{ fontSize: 12, background: "#FEF3C7", color: "#92400E", padding: "2px 8px", borderRadius: 20 }}>📝 {s.note}</span>}
                              {s.effective_date && s.created_at && s.effective_date !== localDateStr(new Date(s.created_at)) && (
                                <span title="วันที่ใช้เทียบถูกย้ายแล้ว" style={{ fontSize: 12, background: "#F3E8FF", color: "#7C3AED", padding: "2px 8px", borderRadius: 20 }}>📅 ย้ายวัน</span>
                              )}
                              {s.pick_status && (
                                <span style={{ fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: s.pick_status === "closed" ? "#F3F4F6" : "#FEF3C7", color: s.pick_status === "closed" ? "#6B7280" : "#92400E" }}>
                                  {s.pick_status === "closed" ? "✅ ตัดสต็อกแล้ว" : "🎯 รอตัดสต็อก (ค้างอยู่)"}
                                </span>
                              )}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 20, background: s.reviewed ? "#D1FAE5" : "#FEF3C7", color: s.reviewed ? "#065F46" : "#92400E" }}>
                                {s.reviewed ? `✅ ตรวจแล้ว · ${s.reviewed_by || ""}` : "⏳ ยังไม่ตรวจ"}
                              </span>
                              <button onClick={(e) => { e.stopPropagation(); toggleScanReviewed(s); }}
                                style={{ background: s.reviewed ? "#F3F4F6" : "#7C3AED", color: s.reviewed ? "#6B7280" : "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                                {s.reviewed ? "เลิกตรวจ" : "ตรวจแล้ว"}
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); handleDeleteScan(s); }}
                                title="ลบรายการนี้ (เช่น ส่งซ้ำ)"
                                style={{ background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                                🗑️
                              </button>
                              <span style={{ color: "#9CA3AF", fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
                            </div>
                          </div>
                          {isOpen && (
                            <div style={{ borderTop: "1px solid #F1F5F9", padding: "14px 16px", display: "grid", gap: 14 }} onClick={e => e.stopPropagation()}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: "#6B7280" }}>
                                📅 วันที่ใช้เทียบกับตัดสต็อก:
                                <input type="date" className="inp" style={{ padding: "4px 8px", fontSize: 12 }}
                                  value={scanEffectiveDate(s) || ""} onChange={e => handleChangeScanDate(s, e.target.value)} />
                                {s.effective_date && s.created_at && s.effective_date !== localDateStr(new Date(s.created_at)) && (
                                  <span style={{ color: "#9CA3AF" }}>(ย้ายจากวันที่ส่งจริง {new Date(s.created_at).toLocaleDateString("th-TH", { day: "2-digit", month: "short" })})</span>
                                )}
                              </div>
                              <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                                <div style={{ fontSize: 12, color: "#6B7280" }}>💳 COD: <b style={{ color: "#92400E" }}>{s.cod_count ?? 0}</b> · โอนเงิน/Bank: <b style={{ color: "#065F46" }}>{s.bank_count ?? 0}</b></div>
                              </div>
                              {s.note && (
                                <div style={{ fontSize: 12, color: "#92400E", background: "#FEF3C7", padding: "8px 10px", borderRadius: 8 }}>📝 <b>หมายเหตุ:</b> {s.note}</div>
                              )}
                              {codEntries.length > 0 && (
                                <div>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 }}>💵 ยอด COD</div>
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {codEntries.map(([amount, count]) => (
                                      <span key={amount} style={{ fontSize: 12, background: "#FEF3C7", color: "#92400E", padding: "4px 10px", borderRadius: 8 }}>{Number(amount).toLocaleString("th-TH")} บาท × {count}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {shipEntries.length > 0 && (
                                <div>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 }}>🚚 ขนส่ง</div>
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {shipEntries.map(([name, count]) => (
                                      <span key={name} style={{ fontSize: 12, background: "#EEF2FF", color: "#4F46E5", padding: "4px 10px", borderRadius: 8 }}>{name} × {count}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 }}>📦 สินค้า (รวม {s.total_items} ชิ้น) — เทียบกับรายการเบิกออกจริง</div>
                                <div style={{ border: "1px solid #F1F5F9", borderRadius: 10, overflow: "hidden" }}>
                                  {products.map((p, i) => (
                                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", borderBottom: i < products.length - 1 ? "1px solid #F1F5F9" : "none", fontSize: 13 }}>
                                      <span style={{ color: "#334155" }}>{p.name}</span>
                                      <span style={{ fontWeight: 700, color: "#4F46E5" }}>{p.qty} ชิ้น</span>
                                    </div>
                                  ))}
                                  {products.length === 0 && <div style={{ padding: 12, color: "#9CA3AF", fontSize: 12, textAlign: "center" }}>ไม่มีรายการสินค้า</div>}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            </div>
          </div>
        )}
      </div>

      {/* ─── MODAL: เพิ่ม/แก้ไขสินค้า ─── */}
      {(showModal === "add" || showModal === "edit") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, backdropFilter: "blur(8px)" }}
          onClick={() => { if (!saving) { setShowModal(null); setForm({}); setSelectedProduct(null); } }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 20, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", padding: 24, boxShadow: "0 24px 60px rgba(0,0,0,0.15)" }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "#111827", marginBottom: 16 }}>
              {showModal === "add" ? "＋ เพิ่มสินค้าใหม่" : "✏️ แก้ไขสินค้า"}
            </h3>
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>ชื่อสินค้า *</label>
                <input className="inp" style={{ marginTop: 4 }} value={form.name || ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="เช่น กล่องพัสดุเบอร์ 0" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>SKU *</label>
                  <input className="inp" style={{ marginTop: 4 }} value={form.sku || ""} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} placeholder="เช่น BOX-000" />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>หมวดหมู่</label>
                  <select className="inp" style={{ marginTop: 4 }} value={form.category || CATEGORIES[0]} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>คงเหลือ</label>
                  <input className="inp" style={{ marginTop: 4 }} type="number" value={form.quantity ?? ""} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} placeholder="0" />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>สต็อกขั้นต่ำ</label>
                  <input className="inp" style={{ marginTop: 4 }} type="number" value={form.minStock ?? ""} onChange={e => setForm(f => ({ ...f, minStock: e.target.value }))} placeholder="0" />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>ราคาทุน (฿)</label>
                  <input className="inp" style={{ marginTop: 4 }} type="number" value={form.price ?? ""} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0.00" />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>หน่วย</label>
                  <input className="inp" style={{ marginTop: 4 }} value={form.unit || ""} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} placeholder="ชิ้น" />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>ตำแหน่งจัดเก็บ</label>
                  <input className="inp" style={{ marginTop: 4 }} value={form.location || ""} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="เช่น ชั้น A-1" />
                </div>
              </div>
              {showModal === "edit" && (
                <div style={{ marginTop: 14 }}>
                  <label style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>ผู้แก้ไข <span style={{ color: "#9CA3AF", fontWeight: 400 }}>(บันทึกลงประวัติการเคลื่อนไหว)</span></label>
                  <input className="inp" style={{ marginTop: 4 }} value={form.editBy || ""} onChange={e => setForm(f => ({ ...f, editBy: e.target.value }))} placeholder="ชื่อผู้แก้ไข เช่น นา" />
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button onClick={() => { setShowModal(null); setForm({}); setSelectedProduct(null); }} disabled={saving}
                style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", color: "#6B7280", borderRadius: 10, padding: "11px 18px", fontSize: 14, cursor: "pointer" }}>ยกเลิก</button>
              <button onClick={showModal === "add" ? handleAddProduct : handleEditProduct} disabled={saving}
                style={{ background: saving ? "#F3F4F6" : "linear-gradient(135deg,#7C3AED,#3B82F6)", color: saving ? "#9CA3AF" : "#fff", border: "none", borderRadius: 10, padding: "11px 22px", fontSize: 14, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>
                {saving ? "⏳ กำลังบันทึก..." : showModal === "add" ? "✅ เพิ่มสินค้า" : "✅ บันทึกการแก้ไข"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: เบิกออก (หลายรายการ) ─── */}
      {showOutBatchModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, backdropFilter: "blur(8px)" }}
          onClick={() => { if (!savingOutBatch) setShowOutBatchModal(false); }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 20, width: "100%", maxWidth: 620, maxHeight: "90vh", overflowY: "auto", padding: 24, boxShadow: "0 24px 60px rgba(0,0,0,0.15)" }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "#DC2626", marginBottom: 4 }}>📤 เบิกออก (หลายรายการ)</h3>
            <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 14 }}>เลือกสินค้าที่จะเบิกออก — ระบบจะตัดสต็อกและบันทึกรายการให้ครั้งเดียว</p>

            <input className="inp" style={{ marginBottom: 10 }} placeholder="🔍 ค้นหาสินค้าเพื่อเพิ่มลงรายการ..."
              value={outBatchSearch} onChange={e => setOutBatchSearch(e.target.value)} />

            {outBatchSearch.trim() !== "" && (
              <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, maxHeight: 180, overflowY: "auto", marginBottom: 14 }}>
                {products
                  .filter(p => p.name.toLowerCase().includes(outBatchSearch.trim().toLowerCase()) || p.sku.toLowerCase().includes(outBatchSearch.trim().toLowerCase()))
                  .slice(0, 20)
                  .map(p => (
                    <div key={p.id} onClick={() => addToOutBatch(p)}
                      style={{ padding: "8px 12px", borderBottom: "1px solid #F3F4F6", cursor: "pointer", fontSize: 13, display: "flex", justifyContent: "space-between" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#FEF2F2"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <span>{p.name} <span style={{ color: "#9CA3AF", fontFamily: "monospace", fontSize: 11 }}>({p.sku})</span></span>
                      <span style={{ color: p.quantity > 0 ? "#DC2626" : "#D1D5DB", fontWeight: 700 }}>{p.quantity > 0 ? `＋ เพิ่ม (คงเหลือ ${p.quantity})` : "หมดสต็อก"}</span>
                    </div>
                  ))}
              </div>
            )}

            <div style={{ border: "1.5px solid #FECACA", borderRadius: 12, padding: 12, marginBottom: 14, background: "#FFFBFB" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#DC2626", marginBottom: 8 }}>รายการที่จะเบิกออก ({outBatchItems.length})</div>
              {outBatchItems.length === 0 && <div style={{ fontSize: 13, color: "#9CA3AF", textAlign: "center", padding: 12 }}>ยังไม่มีรายการ — ค้นหาแล้วกดเพิ่มด้านบน</div>}
              {outBatchItems.map(it => (
                <div key={it.productId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid #FDE8E8" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: "#111827" }}>{it.name}</div>
                    <div style={{ fontSize: 11, color: "#9CA3AF", fontFamily: "monospace" }}>{it.sku} · คงเหลือ {it.maxQty} {it.unit}</div>
                  </div>
                  <input type="number" min="0" max={it.maxQty} value={it.quantity}
                    onChange={e => updateOutBatchQty(it.productId, e.target.value)}
                    style={{ width: 74, background: "#fff", border: "1.5px solid #FECACA", borderRadius: 8, padding: "6px 8px", fontSize: 13, textAlign: "center", outline: "none", fontFamily: "'Sarabun', sans-serif" }} />
                  <span style={{ fontSize: 12, color: "#6B7280", width: 36 }}>{it.unit}</span>
                  <button onClick={() => removeFromOutBatch(it.productId)}
                    style={{ background: "none", border: "none", color: "#D1D5DB", fontSize: 14, cursor: "pointer" }}
                    onMouseEnter={e => e.target.style.color = "#EF4444"} onMouseLeave={e => e.target.style.color = "#D1D5DB"}>✕</button>
                </div>
              ))}
            </div>

            <div>
              <label style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>ผู้ดำเนินการ *</label>
              <input className="inp" style={{ marginTop: 4 }} value={outBatchBy} onChange={e => setOutBatchBy(e.target.value)} placeholder="ชื่อผู้ดำเนินการ" />
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
              <button onClick={() => setShowOutBatchModal(false)} disabled={savingOutBatch}
                style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", color: "#6B7280", borderRadius: 10, padding: "11px 18px", fontSize: 14, cursor: "pointer" }}>ยกเลิก</button>
              <button onClick={handleConfirmOutBatch} disabled={savingOutBatch || outBatchItems.filter(it => it.quantity > 0).length === 0}
                style={{ background: savingOutBatch ? "#F3F4F6" : "#DC2626", color: savingOutBatch ? "#9CA3AF" : "#fff", border: "none", borderRadius: 10, padding: "11px 22px", fontSize: 14, fontWeight: 700, cursor: savingOutBatch ? "not-allowed" : "pointer" }}>
                {savingOutBatch ? "⏳ กำลังบันทึก..." : `✅ เบิกออก ${outBatchItems.filter(it => it.quantity > 0).length} รายการ`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: รับเข้า/เบิกออก ─── */}
      {showModal === "tx" && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, backdropFilter: "blur(8px)" }}
          onClick={() => { if (!saving) setShowModal(null); }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 20, width: "100%", maxWidth: 440, maxHeight: "90vh", overflowY: "auto", padding: 24, boxShadow: "0 24px 60px rgba(0,0,0,0.15)" }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: txType === "in" ? "#059669" : "#DC2626", marginBottom: 16 }}>
              {txType === "in" ? "📥 รับสินค้าเข้าคลัง" : "📤 เบิกสินค้าออก"}
            </h3>
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>สินค้า *</label>
                <select className="inp" style={{ marginTop: 4 }} value={txForm.productId} onChange={e => setTxForm(f => ({ ...f, productId: e.target.value }))}>
                  <option value="">— เลือกสินค้า —</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} (คงเหลือ {p.quantity} {p.unit})</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>จำนวน *</label>
                <input className="inp" style={{ marginTop: 4 }} type="number" min="1" value={txForm.quantity} onChange={e => setTxForm(f => ({ ...f, quantity: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>ผู้ทำรายการ *</label>
                <input className="inp" style={{ marginTop: 4 }} value={txForm.by} onChange={e => setTxForm(f => ({ ...f, by: e.target.value }))} placeholder="ชื่อผู้ทำรายการ" />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>หมายเหตุ</label>
                <input className="inp" style={{ marginTop: 4 }} value={txForm.note} onChange={e => setTxForm(f => ({ ...f, note: e.target.value }))} placeholder="(ถ้ามี)" />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button onClick={() => setShowModal(null)} disabled={saving}
                style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", color: "#6B7280", borderRadius: 10, padding: "11px 18px", fontSize: 14, cursor: "pointer" }}>ยกเลิก</button>
              <button onClick={handleTransaction} disabled={saving}
                style={{ background: saving ? "#F3F4F6" : txType === "in" ? "#059669" : "#DC2626", color: saving ? "#9CA3AF" : "#fff", border: "none", borderRadius: 10, padding: "11px 22px", fontSize: 14, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>
                {saving ? "⏳ กำลังบันทึก..." : txType === "in" ? "✅ รับเข้า" : "✅ เบิกออก"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: รับเข้าตีกลับ (หลายรายการ) ─── */}
      {showReturnBatchModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, backdropFilter: "blur(8px)" }}
          onClick={() => { if (!savingReturnBatch) setShowReturnBatchModal(false); }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 20, width: "100%", maxWidth: 620, maxHeight: "90vh", overflowY: "auto", padding: 24, boxShadow: "0 24px 60px rgba(0,0,0,0.15)" }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "#C2410C", marginBottom: 4 }}>📦 รับเข้าหลายรายการ</h3>
            <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 14 }}>เลือกสินค้าที่จะรับเข้าคลัง — ระบบจะเพิ่มสต็อกให้อัตโนมัติ</p>

            <label style={{ display: "flex", alignItems: "center", gap: 8, background: "#FFFBF5", border: "1.5px solid #FED7AA", borderRadius: 10, padding: "9px 12px", marginBottom: 14, cursor: "pointer" }}>
              <input type="checkbox" checked={returnBatchIsReturn} onChange={e => setReturnBatchIsReturn(e.target.checked)}
                style={{ width: 16, height: 16, cursor: "pointer" }} />
              <span style={{ fontSize: 13, color: "#C2410C", fontWeight: 600 }}>📮 เป็นการรับเข้าตีกลับ (บันทึกหมายเหตุ "ตีกลับ" ให้อัตโนมัติ)</span>
            </label>

            <input className="inp" style={{ marginBottom: 10 }} placeholder="🔍 ค้นหาสินค้าเพื่อเพิ่มลงรายการ..."
              value={returnBatchSearch} onChange={e => setReturnBatchSearch(e.target.value)} />

            {returnBatchSearch.trim() !== "" && (
              <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, maxHeight: 220, overflowY: "auto", marginBottom: returnBatchSelectedIds.size > 0 ? 8 : 14 }}>
                {products
                  .filter(p => p.name.toLowerCase().includes(returnBatchSearch.trim().toLowerCase()) || p.sku.toLowerCase().includes(returnBatchSearch.trim().toLowerCase()))
                  .slice(0, 50)
                  .map(p => {
                    const checked = returnBatchSelectedIds.has(p.id);
                    return (
                      <div key={p.id} onClick={() => toggleReturnBatchSelect(p.id)}
                        style={{ padding: "8px 12px", borderBottom: "1px solid #F3F4F6", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 10, background: checked ? "#FFF7ED" : "transparent" }}
                        onMouseEnter={e => { if (!checked) e.currentTarget.style.background = "#FFFBF5"; }}
                        onMouseLeave={e => { if (!checked) e.currentTarget.style.background = "transparent"; }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleReturnBatchSelect(p.id)} onClick={e => e.stopPropagation()}
                          style={{ width: 15, height: 15, cursor: "pointer", flexShrink: 0 }} />
                        <span style={{ flex: 1 }}>{p.name} <span style={{ color: "#9CA3AF", fontFamily: "monospace", fontSize: 11 }}>({p.sku})</span></span>
                      </div>
                    );
                  })}
              </div>
            )}

            {returnBatchSelectedIds.size > 0 && (
              <button onClick={addSelectedToReturnBatch}
                style={{ width: "100%", background: "#C2410C", color: "#fff", border: "none", borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 14 }}>
                ＋ เพิ่มที่เลือก ({returnBatchSelectedIds.size} รายการ)
              </button>
            )}

            <div style={{ border: "1.5px solid #FED7AA", borderRadius: 12, padding: 12, marginBottom: 14, background: "#FFFBF5" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#C2410C", marginBottom: 8 }}>รายการที่จะรับเข้า ({returnBatchItems.length})</div>
              {returnBatchItems.length === 0 && <div style={{ fontSize: 13, color: "#9CA3AF", textAlign: "center", padding: 12 }}>ยังไม่มีรายการ — ค้นหาแล้วกดเพิ่มด้านบน</div>}
              {returnBatchItems.map(it => (
                <div key={it.productId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid #FDEBD8" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: "#111827" }}>{it.name}</div>
                    <div style={{ fontSize: 11, color: "#9CA3AF", fontFamily: "monospace" }}>{it.sku}</div>
                  </div>
                  <input type="number" min="0" value={it.quantity}
                    onChange={e => updateReturnBatchQty(it.productId, e.target.value)}
                    style={{ width: 74, background: "#fff", border: "1.5px solid #FED7AA", borderRadius: 8, padding: "6px 8px", fontSize: 13, textAlign: "center", outline: "none", fontFamily: "'Sarabun', sans-serif" }} />
                  <span style={{ fontSize: 12, color: "#6B7280", width: 36 }}>{it.unit}</span>
                  <button onClick={() => removeFromReturnBatch(it.productId)}
                    style={{ background: "none", border: "none", color: "#D1D5DB", fontSize: 14, cursor: "pointer" }}
                    onMouseEnter={e => e.target.style.color = "#EF4444"} onMouseLeave={e => e.target.style.color = "#D1D5DB"}>✕</button>
                </div>
              ))}
            </div>

            <div>
              <label style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>ผู้ดำเนินการ *</label>
              <input className="inp" style={{ marginTop: 4 }} value={returnBatchBy} onChange={e => setReturnBatchBy(e.target.value)} placeholder="ชื่อผู้ดำเนินการ" />
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
              <button onClick={() => setShowReturnBatchModal(false)} disabled={savingReturnBatch}
                style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", color: "#6B7280", borderRadius: 10, padding: "11px 18px", fontSize: 14, cursor: "pointer" }}>ยกเลิก</button>
              <button onClick={handleConfirmReturnBatch} disabled={savingReturnBatch || returnBatchItems.filter(it => it.quantity > 0).length === 0}
                style={{ background: savingReturnBatch ? "#F3F4F6" : "#C2410C", color: savingReturnBatch ? "#9CA3AF" : "#fff", border: "none", borderRadius: 10, padding: "11px 22px", fontSize: 14, fontWeight: 700, cursor: savingReturnBatch ? "not-allowed" : "pointer" }}>
                {savingReturnBatch ? "⏳ กำลังบันทึก..." : `✅ รับเข้า${returnBatchIsReturn ? "ตีกลับ" : ""} ${returnBatchItems.filter(it => it.quantity > 0).length} รายการ`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: ประวัติสินค้า ─── */}
      {historyProduct && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, backdropFilter: "blur(8px)" }}
          onClick={() => setHistoryProduct(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 20, width: "100%", maxWidth: 520, maxHeight: "85vh", overflowY: "auto", padding: 24, boxShadow: "0 24px 60px rgba(0,0,0,0.15)" }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: "#111827", marginBottom: 2 }}>🕘 ประวัติ: {historyProduct.name}</h3>
            <p style={{ fontSize: 12, color: "#9CA3AF", fontFamily: "monospace", marginBottom: 14 }}>{historyProduct.sku} · คงเหลือ {historyProduct.quantity} {historyProduct.unit}</p>
            {transactions.filter(tx => tx.productId === historyProduct.id).length === 0 && (
              <div style={{ color: "#9CA3AF", fontSize: 13, textAlign: "center", padding: 24 }}>ยังไม่มีประวัติการเคลื่อนไหว</div>
            )}
            {(() => {
              // transactions มาเรียง created_at.desc อยู่แล้ว (ใหม่สุดก่อน) — ไล่ย้อนคำนวณสต็อกก่อน/หลังแต่ละรายการจากยอดคงเหลือปัจจุบัน
              const txs = transactions.filter(tx => tx.productId === historyProduct.id);
              let running = historyProduct.quantity;
              const withBalance = txs.map(tx => {
                const delta = tx.type === "out" ? -tx.quantity : tx.quantity;
                const after = running;
                const before = after - delta;
                running = before;
                return { tx, before, after };
              });
              return withBalance.map(({ tx, before, after }) => (
                <div key={tx.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #F3F4F6", fontSize: 13 }}>
                  <div>
                    <div style={{ color: "#111827" }}>{tx.type === "in" ? "📥 รับเข้า" : tx.type === "adjust" ? "⚖️ ปรับสต็อก" : "📤 เบิกออก"}{tx.note ? ` · ${tx.note}` : ""}</div>
                    <div style={{ fontSize: 11, color: "#9CA3AF" }}>
                      {tx.createdAt ? new Date(tx.createdAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : tx.date} · โดย {tx.by || "-"}
                    </div>
                    <div style={{ fontSize: 11, color: "#9CA3AF" }}>คงเหลือ {before} → {after} {historyProduct.unit}</div>
                  </div>
                  <span style={{ fontWeight: 700, color: txView(tx).color }}>{txView(tx).amount.trim()}</span>
                </div>
              ));
            })()}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setHistoryProduct(null)}
                style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", color: "#6B7280", borderRadius: 10, padding: "10px 18px", fontSize: 14, cursor: "pointer" }}>ปิด</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── TOAST ─── */}
      {/* ─── ของรอเข้า: จับคู่ชื่อจากระบบใบสั่งกับสินค้าในคลัง ─── */}
      {showIncomingModal && (() => {
        const q = incomingSearch.trim().toLowerCase();
        const rows = incoming.rows.filter(r => !q || r.name.toLowerCase().includes(q));
        const matched = incoming.rows.filter(r => r.productId != null);
        const totalIn = incoming.rows.reduce((t, r) => t + (r.productId != null ? r.inTransit : 0), 0);
        const totalBacklog = incoming.rows.reduce((t, r) => t + (r.productId != null ? r.total : 0), 0);
        const lostIn = incomingUnmatched.reduce((t, r) => t + r.inTransit, 0);
        const lostBacklog = incomingUnmatched.reduce((t, r) => t + r.total, 0);
        const nameOf = (id) => rawProducts.find(p => p.id === id)?.name || "-";
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, backdropFilter: "blur(8px)" }}
            onClick={() => setShowIncomingModal(false)}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 20, width: "100%", maxWidth: 900, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,0.15)" }}>
              <div style={{ padding: "22px 24px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div>
                    <h3 style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>🧾 ของรอเข้า (จากระบบใบสั่ง)</h3>
                    <p style={{ fontSize: 12.5, color: "#6B7280", marginTop: 4 }}>
                      ยอดที่สั่งแล้วยังเข้าไม่ครบ ดึงมาจากระบบใบสั่งโดยตรง — จับคู่ชื่อให้อัตโนมัติ ตัวที่จับไม่ได้เลือกเองด้านล่าง
                    </p>
                  </div>
                  <button onClick={() => setShowIncomingModal(false)}
                    style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", color: "#6B7280", borderRadius: 10, padding: "7px 14px", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>ปิด</button>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                  {[
                    { label: "จับคู่แล้ว", value: `${matched.length} รายการ`, bg: "#ECFDF5", color: "#065F46" },
                    { label: "รวมของรอเข้า", value: `${totalIn.toLocaleString("th-TH")} ชิ้น`, bg: "#F5F3FF", color: "#6D28D9" },
                    { label: "รวมค้างส่ง", value: `${totalBacklog.toLocaleString("th-TH")} ชิ้น`, bg: "#FFFBEB", color: "#B45309" },
                    { label: "ยังไม่จับคู่", value: `${incomingUnmatched.length} รายการ · รอเข้า ${lostIn.toLocaleString("th-TH")} · ค้างส่ง ${lostBacklog.toLocaleString("th-TH")}`, bg: incomingUnmatched.length ? "#FEF3C7" : "#F3F4F6", color: incomingUnmatched.length ? "#B45309" : "#6B7280" },
                  ].map(c => (
                    <div key={c.label} style={{ background: c.bg, borderRadius: 10, padding: "8px 14px" }}>
                      <div style={{ fontSize: 11, color: c.color, opacity: 0.8 }}>{c.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: c.color }}>{c.value}</div>
                    </div>
                  ))}
                </div>
                <input className="inp" style={{ marginTop: 12 }} placeholder="🔍 ค้นหาชื่อจากใบสั่ง..."
                  value={incomingSearch} onChange={e => setIncomingSearch(e.target.value)} />
              </div>

              <div style={{ overflowY: "auto", padding: "0 24px 20px" }}>
                <table>
                  <thead>
                    <tr>
                      <th>ชื่อในใบสั่ง</th>
                      <th style={{ whiteSpace: "nowrap" }}>รอเข้า</th>
                      <th style={{ whiteSpace: "nowrap" }}>ค้างส่ง</th>
                      <th>สินค้าในคลัง</th>
                      <th style={{ whiteSpace: "nowrap" }}>วิธีจับคู่</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id} style={{ background: r.productId == null && (r.inTransit > 0 || r.total > 0) ? "#FFFBEB" : "transparent" }}>
                        <td style={{ fontSize: 13 }}>{r.name}</td>
                        <td style={{ fontFamily: "monospace", fontWeight: r.inTransit > 0 ? 700 : 400, color: r.inTransit > 0 ? "#7C3AED" : "#D1D5DB" }}>
                          {r.inTransit > 0 ? r.inTransit.toLocaleString("th-TH") : "-"}
                        </td>
                        <td style={{ fontFamily: "monospace", fontWeight: r.total > 0 ? 700 : 400, color: r.total > 0 ? "#B45309" : "#D1D5DB" }}>
                          {r.total > 0 ? r.total.toLocaleString("th-TH") : "-"}
                        </td>
                        <td>
                          <ProductPicker
                            products={rawProducts}
                            value={r.manual ? (r.productId == null ? "none" : String(r.productId)) : "auto"}
                            autoLabel={r.productId != null && !r.manual ? `⚙️ อัตโนมัติ — ${nameOf(r.productId)}` : "⚙️ ให้ระบบจับคู่เอง"}
                            onPick={v => setAlias(r.name, v === "auto" ? "auto" : v === "none" ? null : Number(v))}
                          />
                        </td>
                        <td style={{ fontSize: 11.5, color: r.productId == null ? "#B45309" : "#6B7280", whiteSpace: "nowrap" }}>{r.how}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length === 0 && <div style={{ textAlign: "center", padding: 36, color: "#9CA3AF", fontSize: 13 }}>ไม่พบรายการ</div>}
                <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 10 }}>
                  * ยอดรอเข้า/ค้างส่งอ่านจากระบบใบสั่งอย่างเดียว ไม่เขียนกลับ — แก้จำนวนต้องไปแก้ที่ระบบใบสั่ง
                  <br />* การจับคู่ที่เลือกเองเก็บไว้ในเบราว์เซอร์เครื่องนี้ (เครื่องอื่นจะเห็นเฉพาะที่ระบบจับคู่ให้อัตโนมัติ)
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 400, background: toast.type === "success" ? "#065F46" : "#991B1B", color: "#fff", borderRadius: 12, padding: "12px 24px", fontSize: 14, fontWeight: 600, boxShadow: "0 12px 32px rgba(0,0,0,0.25)", maxWidth: "90vw" }}>
          {toast.type === "success" ? "✅ " : "⚠️ "}{toast.msg}
        </div>
      )}
    </div>
  );
}
