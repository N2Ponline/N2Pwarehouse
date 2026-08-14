import { useState, useEffect, useCallback, useRef, useMemo } from "react";

const SUPABASE_URL = "https://slwbzbnomsugffyzjyuv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNsd2J6Ym5vbXN1Z2ZmeXpqeXV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjIxMDcsImV4cCI6MjA5NTI5ODEwN30.qG3CPT6J_evddK8qmpF7P3bVswn_Du43MEHo33bUnqA";

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
};

const dbToProduct = (r) => ({
  id: r.id, sku: r.sku, name: r.name, category: r.category || "-",
  quantity: r.quantity, minStock: r.min_stock, price: Number(r.price),
  location: r.location || "-", unit: r.unit, imageUrl: r.image_url,
  qtyOnOrder: r.qty_on_order || 0,
});
const productToDb = (p) => ({
  sku: p.sku, name: p.name, category: p.category,
  quantity: parseInt(p.quantity) || 0,
  min_stock: parseInt(p.minStock) || 0,
  price: parseFloat(p.price) || 0,
  location: p.location || "-", unit: p.unit || "ชิ้น",
  image_url: p.imageUrl || null,
  qty_on_order: parseInt(p.qtyOnOrder) || 0,
});
const dbToTx = (r) => ({
  id: r.id, type: r.type, productId: r.product_id,
  quantity: r.quantity, date: r.date, note: r.note, by: r.by,
});

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
