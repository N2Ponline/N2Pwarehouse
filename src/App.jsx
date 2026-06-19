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

const api = {
  getProducts: () => sb("products?select=*&order=name.asc"),
  addProduct: (p) => sb("products", { method: "POST", body: JSON.stringify(p) }),
  updateProduct: (id, p) => sb(`products?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(p) }),
  deleteProduct: (id) => sb(`products?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }),
  getTransactions: () => sb("transactions?select=*&order=created_at.desc"),
  addTransaction: (t) => sb("transactions", { method: "POST", body: JSON.stringify(t) }),
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
});

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

const sbReturn = async (path, opts = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json", Prefer: "return=representation", ...opts.headers },
    ...opts,
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

  XLSX.writeFile(wb, `return_report_${new Date().toISOString().slice(0,10)}.xlsx`);
}


// ============================================================
// RETURN SUMMARY PANEL — สรุปรวม ตีกลับในระบบ + ตีกลับถึงคลัง
// แท็บที่ 3 ใน ReturnCheckerTab
// ตัวกรองอิสระ 2 ชุด: sessions (Flash แจ้ง) / scans (ถึงคลัง)
// + toggle "ยังไม่ถึงคลัง" (highlight สีแดงทั้งหมด)
// ============================================================

function todayStr() { return new Date().toISOString().slice(0, 10); }
function yesterdayStr() { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }

function useDateFilterState(defaultMode = "all") {
  const [mode, setMode] = useState(defaultMode); // all | today | yesterday | range
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(todayStr());
  const single = mode === "today" ? todayStr() : mode === "yesterday" ? yesterdayStr() : null;
  return { mode, setMode, from, setFrom, to, setTo, single };
}

// ── โหลด return_sessions ตามตัวกรองวันที่ (กรองที่ server ผ่าน session_date) ──
async function loadSessionsFiltered(filter) {
  let q = "select=*&order=session_date.desc";
  if (filter.mode === "today" || filter.mode === "yesterday") {
    q += `&session_date=eq.${filter.single}`;
  } else if (filter.mode === "range") {
    if (filter.from) q += `&session_date=gte.${filter.from}`;
    if (filter.to) q += `&session_date=lte.${filter.to}`;
  }
  // mode === "all" → ไม่เติมเงื่อนไข
  return sbReturnAll("return_sessions", q);
}

// ── โหลด return_scans ตามตัวกรองวันที่ (กรองที่ server ผ่าน scan_date) ──
// รองรับ record เก่าที่ scan_date เป็น null โดย fallback ไปเทียบ scanned_at เพิ่มอีกชุด
async function loadScansFiltered(filter) {
  if (filter.mode === "all") {
    // ทั้งหมด: ดึงตรง ๆ ไม่ต้อง fallback (ได้ทุก record อยู่แล้ว)
    return sbReturnAll("return_scans", "select=*&order=scanned_at.desc");
  }

  // กรณีกรองวันที่/ช่วงวันที่: query หลักด้วย scan_date ตรง ๆ
  let mainQ = "select=*&order=scanned_at.desc";
  let from, to;
  if (filter.mode === "today" || filter.mode === "yesterday") {
    from = to = filter.single;
  } else {
    from = filter.from || null;
    to = filter.to || null;
  }
  if (from) mainQ += `&scan_date=gte.${from}`;
  if (to) mainQ += `&scan_date=lte.${to}`;
  const mainRows = await sbReturnAll("return_scans", mainQ);

  // query เสริม: record ที่ scan_date เป็น null (ของเก่าก่อน migration) — เทียบ scanned_at เอง
  const nullDateRows = await sbReturnAll("return_scans", "select=*&scan_date=is.null&order=scanned_at.desc");
  const fallbackMatches = nullDateRows.filter(sc => {
    if (!sc.scanned_at) return false;
    const d = sc.scanned_at.slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });

  // รวมสองชุด กันซ้ำด้วย id
  const seen = new Set(mainRows.map(r => r.id));
  const merged = [...mainRows];
  fallbackMatches.forEach(r => { if (!seen.has(r.id)) { merged.push(r); seen.add(r.id); } });
  return merged;
}

function ReturnSummaryPanel() {
  const sessFilter = useDateFilterState("today");
  const scanFilter = useDateFilterState("all");
  const [showMissingOnly, setShowMissingOnly] = useState(false);

  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [scans, setScans] = useState([]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sessRows, scanRows] = await Promise.all([
        loadSessionsFiltered(sessFilter),
        loadScansFiltered(scanFilter),
      ]);
      setSessions(sessRows || []);
      setScans(scanRows || []);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [sessFilter.mode, sessFilter.from, sessFilter.to, scanFilter.mode, scanFilter.from, scanFilter.to]);

  // ── คำนวณ matched / missing / extra จากตัวกรองทั้งสองฝั่ง ──
  const systemList = useMemo(() => [...new Set(sessions.flatMap(s => s.tracking_list || []))], [sessions]);
  // map: tracking code -> วันที่ Flash แจ้ง (session_date ของ session ที่มีโค้ดนี้)
  const codeToSessionDate = useMemo(() => {
    const map = {};
    sessions.forEach(s => {
      (s.tracking_list || []).forEach(code => {
        if (!map[code]) map[code] = s.session_date;
      });
    });
    return map;
  }, [sessions]);
  const scannedSet = useMemo(() => new Set(scans.map(sc => sc.tracking_code)), [scans]);
  const matched = useMemo(() => systemList.filter(c => scannedSet.has(c)), [systemList, scannedSet]);
  const missing = useMemo(() => systemList.filter(c => !scannedSet.has(c)), [systemList, scannedSet]);
  const extra = useMemo(() => {
    const seen = new Set();
    return scans.filter(sc => {
      if (systemList.includes(sc.tracking_code)) return false;
      if (seen.has(sc.tracking_code)) return false;
      seen.add(sc.tracking_code);
      return true;
    });
  }, [scans, systemList]);

  const pct = systemList.length > 0 ? Math.round((matched.length / systemList.length) * 100) : 0;

  // ── UI ย่อย: ปุ่มเลือกช่วงวันที่ ใช้ซ้ำได้ทั้งสองฝั่ง ──
  const DateFilterRow = ({ filter, accent }) => (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {[["all", "ทั้งหมด"], ["today", "วันนี้"], ["yesterday", "เมื่อวาน"]].map(([v, l]) => (
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

  const fmtTime = (iso) => iso ? new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-";

  const [exporting, setExporting] = useState(false);
  const filterLabel = (f) => {
    if (f.mode === "all") return "ทั้งหมด";
    if (f.mode === "today") return "วันนี้ (" + todayStr() + ")";
    if (f.mode === "yesterday") return "เมื่อวาน (" + yesterdayStr() + ")";
    return `${f.from || "?"} — ${f.to || "?"}`;
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
        ["ตัวกรอง Flash แจ้ง", filterLabel(sessFilter)],
        ["ตัวกรอง ถึงคลัง", filterLabel(scanFilter)],
        ["", ""],
        [{ v: "รายการ", s: HEADER }, { v: "จำนวน (ชิ้น)", s: HEADER }],
        ["📋 Flash แจ้ง (ตามตัวกรอง)", systemList.length],
        ["📦 ถึงคลัง (ตามตัวกรอง)", scans.length],
        [{ v: "✅ ตรงกัน", s: GREEN }, { v: matched.length, s: GREEN }],
        [{ v: "🔴 ยังไม่ถึงคลัง", s: RED }, { v: missing.length, s: RED }],
        [{ v: "⚠️ ยิงเกิน (ไม่อยู่ในระบบ)", s: ORANGE }, { v: extra.length, s: ORANGE }],
        ["", ""],
        [{ v: `ความครบถ้วน: ${pct}%`, s: { font: { bold: true, color: { rgb: pct === 100 ? "007A3D" : "CC0000" } } } }, ""],
      ]);
      ws1["!cols"] = [{ wch: 36 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(wb, ws1, "สรุปยอด");

      // Sheet 2: ตรงกัน
      const ws2 = XLSX.utils.aoa_to_sheet([
        [{ v: "เลข Tracking", s: HEADER }, { v: "ผู้ยิง", s: HEADER }, { v: "เวลายิง", s: HEADER }],
        ...matched.map(code => {
          const sc = scans.find(s => s.tracking_code === code);
          return [{ v: code, s: GREEN }, sc?.scanned_by || "-", sc?.scanned_at ? new Date(sc.scanned_at).toLocaleString("th-TH") : "-"];
        }),
      ]);
      ws2["!cols"] = [{ wch: 30 }, { wch: 16 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(wb, ws2, "ตรงกัน");

      // Sheet 3: ยังไม่ถึงคลัง
      const ws3 = XLSX.utils.aoa_to_sheet([
        [{ v: "เลข Tracking (ยังไม่ถึงคลัง)", s: HEADER }, { v: "สถานะ", s: HEADER }],
        ...missing.map(code => [{ v: code, s: RED }, { v: "🔴 ยังไม่รับ / ยังไม่ลงระบบ", s: RED }]),
      ]);
      ws3["!cols"] = [{ wch: 30 }, { wch: 26 }];
      XLSX.utils.book_append_sheet(wb, ws3, "ยังไม่ถึงคลัง");

      // Sheet 4: ยิงเกิน
      const ws4 = XLSX.utils.aoa_to_sheet([
        [{ v: "เลข Tracking (ยิงเกิน)", s: HEADER }, { v: "ผู้ยิง", s: HEADER }, { v: "เวลายิง", s: HEADER }],
        ...extra.map(sc => [{ v: sc.tracking_code, s: ORANGE }, sc.scanned_by || "-", sc.scanned_at ? new Date(sc.scanned_at).toLocaleString("th-TH") : "-"]),
      ]);
      ws4["!cols"] = [{ wch: 30 }, { wch: 16 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(wb, ws4, "ยิงเกิน");

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
          <p style={{ fontSize: 13, color: "#6B7280" }}>เทียบ Flash แจ้ง กับ พนักงานยิงถึงคลัง — กรองวันที่อิสระกันได้ทั้งสองฝั่ง</p>
        </div>
        <button onClick={handleSummaryExport} disabled={exporting}
          style={{ background: "#EDE9FE", color: "#7C3AED", border: "1px solid #DDD6FE", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>
          {exporting ? "⏳..." : "📥 Export Excel"}
        </button>
      </div>

      {/* ตัวกรองอิสระ 2 ชุด */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#7C3AED", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>🗂 ตีกลับในระบบ (Flash แจ้ง)</div>
          <DateFilterRow filter={sessFilter} accent="linear-gradient(135deg,#7C3AED,#3B82F6)" />
        </div>
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#0EA5E9", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>📦 ตีกลับถึงคลัง (พนักงานยิง)</div>
          <DateFilterRow filter={scanFilter} accent="#0EA5E9" />
        </div>
      </div>

      {/* ตัวกรองที่ 3: ยังไม่ถึงคลัง */}
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
            แสดง {missing.length} รายการที่ Flash แจ้งไว้ (ตามตัวกรองซ้าย) แต่ยังไม่เจอใน scans (ตามตัวกรองขวา)
          </span>
        )}
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Flash แจ้ง", value: systemList.length, color: "#6B7280", bg: "#F9FAFB" },
          { label: "ถึงคลัง", value: scans.length, color: "#111827", bg: "#F9FAFB" },
          { label: "✅ ตรงกัน", value: matched.length, color: "#065F46", bg: "#D1FAE5" },
          { label: "🔴 ยังไม่ถึงคลัง", value: missing.length, color: missing.length > 0 ? "#991B1B" : "#065F46", bg: missing.length > 0 ? "#FEE2E2" : "#D1FAE5" },
          { label: "⚠️ ยิงเกิน", value: extra.length, color: "#92400E", bg: "#FEF3C7" },
        ].map((s, i) => (
          <div key={i} style={{ background: s.bg, borderRadius: 14, padding: "16px 14px", textAlign: "center", border: "1px solid #E5E7EB" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: "#6B7280", marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      {systemList.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ height: 8, background: "#F3F4F6", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: pct === 100 ? "#10B981" : "linear-gradient(90deg,#7C3AED,#3B82F6)", borderRadius: 4, transition: "width 0.4s" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, color: "#6B7280" }}>
            <span>ความครบถ้วน (เทียบตามตัวกรองที่เลือก)</span>
            <span style={{ fontWeight: 700, color: pct === 100 ? "#10B981" : "#7C3AED" }}>{pct}%</span>
          </div>
        </div>
      )}

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

      {/* มุมมองปกติ: สองคอลัมน์ ระบบ vs ถึงคลัง */}
      {!loading && !showMissingOnly && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: 16 }}>
            <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 600, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
              Flash แจ้ง ({systemList.length})
            </div>
            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              {systemList.map((code, i) => {
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
              ถึงคลัง ({scans.length})
            </div>
            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              {scans.map((sc, i) => {
                const inSystem = systemList.includes(sc.tracking_code);
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
              {scans.length === 0 && <div style={{ color: "#9CA3AF", fontSize: 13 }}>ไม่มีข้อมูลถึงคลังตามตัวกรองนี้</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function ReturnAdminPanel() {
  const [flashText, setFlashText] = useState("");
  const [loading, setLoading] = useState(false);
  const [dateFilter, setDateFilter] = useState(""); // "" = ทั้งหมด
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0,10));
  const [sessions, setSessions] = useState([]);
  const [loadingList, setLoadingList] = useState(false);

  const loadList = async (date, from = dateFrom, to = dateTo) => {
    setLoadingList(true);
    try {
      let sessionFilter = "select=*&order=session_date.desc";
      if (date) sessionFilter += `&session_date=eq.${date}`;
      else if (from && to) sessionFilter += `&session_date=gte.${from}&session_date=lte.${to}`;
      else if (from) sessionFilter += `&session_date=gte.${from}`;
      else if (to) sessionFilter += `&session_date=lte.${to}`;
      const rows = await sbReturnAll("return_sessions", sessionFilter);
      setSessions(rows || []);
    } catch (e) { console.error(e); }
    setLoadingList(false);
  };

  useEffect(() => { loadList(dateFilter, dateFrom, dateTo); }, [dateFilter, dateFrom, dateTo]);

  // เลข tracking ทั้งหมด พร้อมวันที่ที่ Flash แจ้งมา (เรียงตามวันที่ล่าสุดก่อน เพราะ sessions โหลดมา desc แล้ว)
  const codeRows = useMemo(() => {
    const seen = new Set();
    const rows = [];
    sessions.forEach(s => {
      (s.tracking_list || []).forEach(code => {
        if (seen.has(code)) return;
        seen.add(code);
        rows.push({ code, sessionDate: s.session_date, sessionId: s.id });
      });
    });
    return rows;
  }, [sessions]);

  const handleCreate = async () => {
    const list = parseFlashText(flashText);
    if (!list.length) return alert("ไม่พบเลข tracking กรุณาตรวจสอบข้อความ");
    setLoading(true);
    try {
      if (list.length > 5000 && !confirm(`พบ ${list.length.toLocaleString()} รายการ ยืนยันสร้าง?`)) { setLoading(false); return; }
      const saveDate = dateFilter || new Date().toISOString().slice(0,10);
      await sbReturn("return_sessions", { method: "POST", body: JSON.stringify({ tracking_list: list, courier: "Flash", session_date: saveDate }) });
      setFlashText("");
      loadList(dateFilter, dateFrom, dateTo);
    } catch (e) { alert("เกิดข้อผิดพลาด: " + JSON.stringify(e)); }
    setLoading(false);
  };

  const handleDeleteTracking = async (code, sessionId) => {
    if (!confirm(`ลบ ${code} ออกจากระบบ?`)) return;
    const sess = sessions.find(s => s.id === sessionId);
    if (!sess) return;
    const newList = (sess.tracking_list || []).filter(c => c !== code);
    try {
      await sbReturn(`return_sessions?id=eq.${sess.id}`, { method: "PATCH", body: JSON.stringify({ tracking_list: newList }) });
      await loadList(dateFilter, dateFrom, dateTo);
    } catch (e) { alert("ลบไม่สำเร็จ"); }
  };

  const preview = parseFlashText(flashText);

  return (
    <div>
      {/* Date selector */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 4 }}>ตีกลับในระบบ</h2>
          <p style={{ fontSize: 13, color: "#6B7280" }}>ดูและลงรายการพัสดุตีกลับตามวันที่</p>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => { setDateFilter(""); setDateFrom(""); setDateTo(new Date().toISOString().slice(0,10)); }}
            style={{ background: !dateFilter && !dateFrom ? "linear-gradient(135deg,#7C3AED,#3B82F6)" : "#fff", color: !dateFilter && !dateFrom ? "#fff" : "#6B7280", border: "1px solid #E5E7EB", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>
            ทั้งหมด
          </button>
          <button onClick={() => { setDateFilter(new Date().toISOString().slice(0,10)); setDateFrom(""); setDateTo(""); }}
            style={{ background: dateFilter === new Date().toISOString().slice(0,10) ? "linear-gradient(135deg,#7C3AED,#3B82F6)" : "#fff", color: dateFilter === new Date().toISOString().slice(0,10) ? "#fff" : "#6B7280", border: "1px solid #E5E7EB", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>
            วันนี้
          </button>
          <button onClick={() => { const d = new Date(); d.setDate(d.getDate()-1); setDateFilter(d.toISOString().slice(0,10)); setDateFrom(""); setDateTo(""); }}
            style={{ background: "#fff", color: "#6B7280", border: "1px solid #E5E7EB", borderRadius: 8, padding: "7px 14px", fontSize: 13, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>
            เมื่อวาน
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 4, background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "4px 8px" }}>
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setDateFilter(""); }}
              placeholder="จากวันที่"
              style={{ background: "transparent", border: "none", color: "#374151", fontSize: 12, outline: "none", fontFamily: "'Sarabun', sans-serif", width: 120 }} />
            <span style={{ color: "#9CA3AF", fontSize: 12 }}>—</span>
            <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setDateFilter(""); }}
              placeholder="ถึงวันที่"
              style={{ background: "transparent", border: "none", color: "#374151", fontSize: 12, outline: "none", fontFamily: "'Sarabun', sans-serif", width: 120 }} />
          </div>
        </div>
      </div>

      {/* ลิสต์ FLASH แจ้ง — เลข tracking + วันที่ เท่านั้น */}
      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: 16, marginBottom: 24 }}>
        <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 600, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
          FLASH แจ้ง ({codeRows.length})
        </div>
        {loadingList && <div style={{ textAlign: "center", padding: 40, color: "#6B7280" }}>กำลังโหลดข้อมูล...</div>}
        {!loadingList && (
          <div style={{ maxHeight: 480, overflowY: "auto" }}>
            {codeRows.map((row, i) => {
              const dateLabel = row.sessionDate ? new Date(row.sessionDate + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }) : "";
              return (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #F3F4F6", fontSize: 13 }}>
                  <span style={{ fontFamily: "monospace", color: "#111827" }}>{row.code}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {dateLabel && <span style={{ fontSize: 11, color: "#6B7280", background: "#F3F4F6", borderRadius: 4, padding: "2px 8px" }}>📅 {dateLabel}</span>}
                    <button onClick={() => handleDeleteTracking(row.code, row.sessionId)}
                      style={{ background: "none", border: "none", color: "#D1D5DB", cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1 }}
                      onMouseEnter={e => e.target.style.color="#EF4444"} onMouseLeave={e => e.target.style.color="#D1D5DB"}
                      title="ลบออกจากระบบ">✕</button>
                  </div>
                </div>
              );
            })}
            {codeRows.length === 0 && <div style={{ color: "#9CA3AF", fontSize: 13, textAlign: "center", padding: 24 }}>ไม่มีข้อมูล Flash แจ้งตามตัวกรองนี้</div>}
          </div>
        )}
      </div>

      {/* Import section */}
      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 20, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>📋 เพิ่มรายการจาก Flash Express</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, color: "#6B7280" }}>บันทึกเข้าวันที่:</span>
            <input type="date" value={dateFilter || new Date().toISOString().slice(0,10)} onChange={e => setDateFilter(e.target.value)}
              style={{ background: "#F9FAFB", border: "1.5px solid #DDD6FE", borderRadius: 8, padding: "6px 12px", color: "#7C3AED", fontSize: 13, outline: "none", fontFamily: "'Sarabun', sans-serif", fontWeight: 600 }} />
            <span style={{ background: "#EDE9FE", color: "#7C3AED", borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 600 }}>
              📅 {new Date(dateFilter || new Date().toISOString().slice(0,10)).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })}
            </span>
          </div>
        </div>
        <textarea value={flashText} onChange={e => setFlashText(e.target.value)}
          placeholder="วางข้อความจาก Flash Express ที่นี่...&#10;รองรับทุก format เช่น TH27218RHRH38A 15:02/TH27218RJD230A 15:11/..."
          style={{ width: "100%", height: 120, background: "#F9FAFB", border: "1.5px solid #E5E7EB", borderRadius: 12, padding: 14, color: "#111827", fontSize: 13, resize: "vertical", outline: "none", lineHeight: 1.8, fontFamily: "'Sarabun', sans-serif" }} />
        {flashText.trim() && (
          <div style={{ marginTop: 6, fontSize: 13, color: "#6B7280" }}>
            พบ <span style={{ color: "#7C3AED", fontWeight: 700 }}>{preview.length}</span> รายการ
            — จะบันทึกเข้า <span style={{ color: "#7C3AED", fontWeight: 700 }}>{new Date(dateFilter || new Date().toISOString().slice(0,10)).toLocaleDateString("th-TH", { dateStyle: "long" })}</span>
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 12, justifyContent: "flex-end" }}>
          <button onClick={handleCreate} disabled={!flashText.trim() || loading}
            style={{ background: flashText.trim() && !loading ? "linear-gradient(135deg,#7C3AED,#3B82F6)" : "#F3F4F6", color: flashText.trim() && !loading ? "#fff" : "#9CA3AF", border: "none", borderRadius: 10, padding: "10px 22px", fontSize: 14, fontWeight: 700, cursor: flashText.trim() ? "pointer" : "not-allowed", fontFamily: "'Sarabun', sans-serif" }}>
            {loading ? "กำลังบันทึก..." : "✅ บันทึกเข้าระบบ"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReturnStaffPanel() {
  const [staffName, setStaffName] = useState(localStorage.getItem("staffName") || "");
  const [mode, setMode] = useState("idle");
  const [staging, setStaging] = useState([]);
  const [submitted, setSubmitted] = useState([]);
  const [systemList, setSystemList] = useState([]);
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
  const today = new Date().toISOString().slice(0,10);

  useEffect(() => { stagingCodesRef.current = staging.map(s => s.code); }, [staging]);
  useEffect(() => { submittedCodesRef.current = submitted.map(s => s.tracking_code); }, [submitted]);
  useEffect(() => { if (staffName) loadData(); }, [staffName]);
  useEffect(() => { if (mode === "scanning" && scanRef.current) scanRef.current.focus(); }, [mode]);
  useEffect(() => { return () => { closeCamera(); }; }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const sessions = await sbReturnAll("return_sessions", `select=*&session_date=eq.${today}`);
      setSystemList([...new Set(sessions.flatMap(s => s.tracking_list || []))]);
      const allScans = [];
      for (const s of sessions) {
        const scans = await sbReturnAll("return_scans", `session_id=eq.${s.id}&select=tracking_code,scanned_by,scanned_at&order=scanned_at.desc`);
        allScans.push(...scans);
      }
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
    setLastScan({ code, status: systemList.includes(code) ? "match" : "extra" });
    playBeep(systemList.includes(code));
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
    setLastScan({ code, status: systemList.includes(code) ? "match" : "extra" });
    playBeep(systemList.includes(code));
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
  const extra = allCodes.filter(c => !systemList.includes(c));
  const progress = systemList.length > 0 ? Math.round(matched.length / systemList.length * 100) : 0;

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

      {systemList.length === 0 && (
        <div style={{ background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 12, padding: "12px 16px", marginBottom: 14, fontSize: 13, color: "#92400E" }}>
          ⚠️ แอดมินยังไม่ได้ลงรายการวันนี้ — ยิงได้เลย ระบบจะแมทให้อัตโนมัติเมื่อแอดมินลงข้อมูล
        </div>
      )}

      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <button onClick={() => { setMode("scanning"); setStaging([]); setLastScan(null); }}
          style={{ background: "linear-gradient(135deg,#7C3AED,#3B82F6)", color: "#fff", border: "none", borderRadius: 12, padding: "13px 36px", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "'Sarabun', sans-serif", boxShadow: "0 8px 20px rgba(124,58,237,0.3)" }}>
          📦 เริ่มยิงบาร์โค้ด
        </button>
      </div>

      {submitted.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: 12, maxHeight: 200, overflowY: "auto" }}>
          <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>ยิงและบันทึกแล้ว ({submitted.length})</div>
          {submitted.map((s, i) => {
            const ok = systemList.includes(s.tracking_code);
            return (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid #F3F4F6" }}>
                <span style={{ fontFamily: "monospace", fontSize: 11, color: ok ? "#065F46" : "#92400E" }}>{s.tracking_code}</span>
                <span style={{ fontSize: 11, color: "#6B7280" }}>
                  {s.scanned_by} · {s.scanned_at ? new Date(s.scanned_at).toLocaleDateString("th-TH", { day: "numeric", month: "short" }) + " " + new Date(s.scanned_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}

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
                const ok = systemList.includes(entry.code);
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

function ReturnCheckerTab() {
  const [subTab, setSubTab] = useState(() => localStorage.getItem("returnSubTab") || "summary");
  const setAndSave = (v) => { setSubTab(v); localStorage.setItem("returnSubTab", v); };
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
        {[["summary","📊 สรุปรวม"],["admin","🗂 ตีกลับในระบบ"],["staff","📦 ตีกลับถึงคลัง"]].map(([v,l]) => (
          <button key={v} onClick={() => setAndSave(v)}
            style={{ background: subTab === v ? "linear-gradient(135deg,#7C3AED,#3B82F6)" : "#fff", color: subTab === v ? "#fff" : "#6B7280", border: subTab === v ? "none" : "1px solid #E5E7EB", borderRadius: 10, padding: "9px 20px", fontSize: 14, fontWeight: subTab === v ? 700 : 400, cursor: "pointer", fontFamily: "'Sarabun', sans-serif", transition: "all 0.2s", boxShadow: subTab === v ? "0 4px 12px rgba(124,58,237,0.3)" : "none" }}>
            {l}
          </button>
        ))}
      </div>
      {subTab === "summary" ? <ReturnSummaryPanel /> : subTab === "admin" ? <ReturnAdminPanel /> : <ReturnStaffPanel />}
    </div>
  );
}

// ============================================================
export default function WarehouseApp() {
  const [products, setProducts] = useState([]);
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
  const [disposeMode, setDisposeMode] = useState(false);
  const [selectedForDispose, setSelectedForDispose] = useState(new Set());
  const [showAllDormant, setShowAllDormant] = useState(false);
  const [disposeRecords, setDisposeRecords] = useState([]);
  const [loadingDispose, setLoadingDispose] = useState(false);
  const [disposeSearch, setDisposeSearch] = useState("");
  const [historyProduct, setHistoryProduct] = useState(null); // product ที่กดดูประวัติ
  const [filterProductId, setFilterProductId] = useState(null); // filter transactions by product

  const loadDisposeRecords = async () => {
    setLoadingDispose(true);
    try {
      const data = await sb("dispose_records?select=*&order=disposed_at.desc");
      setDisposeRecords(data || []);
    } catch (e) { console.error(e); }
    setLoadingDispose(false);
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
      XLSX.writeFile(wb, `dispose_report_${new Date().toISOString().slice(0,10)}.xlsx`);
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
      setProducts(prev => prev.filter(p => !selectedForDispose.has(p.id)));
      setTransactions(prev => prev.filter(tx => !selectedForDispose.has(tx.productId)));
      setSelectedForDispose(new Set());
      setDisposeMode(false);
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
  const [saving, setSaving] = useState(false);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    setDbError(null);
    try {
      const [prods, txs] = await Promise.all([api.getProducts(), api.getTransactions()]);
      setProducts((prods || []).map(dbToProduct));
      setTransactions((txs || []).map(dbToTx));
    } catch (e) {
      setDbError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { if (tab === "dispose") loadDisposeRecords(); }, [tab]);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
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

      XLSX.writeFile(wb, `stock_check_${new Date().toISOString().slice(0,10)}.xlsx`);
    } catch (e) { alert("Export ไม่สำเร็จ: " + e.message); }
    setExportingInventory(false);
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
      setProducts(prev => [...prev, dbToProduct(created)].sort((a,b) => a.name.localeCompare(b.name, "th")));
      setShowModal(null); setForm({});
      showToast("เพิ่มสินค้าสำเร็จ");
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const handleEditProduct = async () => {
    setSaving(true);
    try {
      const [updated] = await api.updateProduct(selectedProduct.id, productToDb(form));
      setProducts(prev => prev.map(p => p.id === selectedProduct.id ? dbToProduct(updated) : p));
      setShowModal(null); setForm({}); setSelectedProduct(null);
      showToast("แก้ไขสินค้าสำเร็จ");
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const handleDeleteProduct = async (id) => {
    if (!confirm("ยืนยันลบสินค้านี้?")) return;
    try {
      await api.deleteProduct(id);
      setProducts(prev => prev.filter(p => p.id !== id));
      showToast("ลบสินค้าสำเร็จ");
    } catch (e) { showToast(e.message, "error"); }
  };

  const handleTransaction = async () => {
    if (!txForm.productId || !txForm.quantity || !txForm.by) return showToast("กรุณากรอกข้อมูลให้ครบ", "error");
    const qty = parseInt(txForm.quantity);
    const pid = parseInt(txForm.productId);
    const product = products.find(p => p.id === pid);
    // อนุญาตให้สต็อกติดลบได้
    setSaving(true);
    try {
      const newQty = txType === "in" ? product.quantity + qty : product.quantity - qty;
      await api.updateProduct(pid, { quantity: newQty });
      const [newTx] = await api.addTransaction({ type: txType, product_id: pid, quantity: qty, date: new Date().toISOString().split("T")[0], note: txForm.note || null, by: txForm.by });
      setProducts(prev => prev.map(p => p.id === pid ? { ...p, quantity: newQty } : p));
      setTransactions(prev => [dbToTx(newTx), ...prev]);
      setTxForm({ productId: "", quantity: "", note: "", by: "" });
      setShowModal(null);
      showToast(txType === "in" ? "รับสินค้าเข้าคลังสำเร็จ" : "เบิกสินค้าออกสำเร็จ");
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const openEdit = (product) => {
    setSelectedProduct(product);
    setForm({ ...product, quantity: String(product.quantity), minStock: String(product.minStock), price: String(product.price) });
    setShowModal("edit");
  };

  const handleImageUpload = async (product, file) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      try {
        await api.updateProduct(product.id, { image_url: dataUrl });
        setProducts(prev => prev.map(p => p.id === product.id ? { ...p, imageUrl: dataUrl } : p));
        showToast("อัปโหลดรูปสำเร็จ");
      } catch (err) { showToast(err.message, "error"); }
    };
    reader.readAsDataURL(file);
  };

  if (loading) return (
    <div style={{ fontFamily: "'Sarabun', sans-serif", minHeight: "100vh", background: "#f0f2ff", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');`}</style>
      <div style={{ width: 48, height: 48, border: "3px solid #e0e0f0", borderTop: "3px solid #7c3aed", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <div style={{ color: "#6b7ab5", fontSize: 15 }}>กำลังโหลดข้อมูลจาก Supabase...</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (dbError) return (
    <div style={{ fontFamily: "'Sarabun', sans-serif", minHeight: "100vh", background: "#f0f2ff", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, padding: 32 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');`}</style>
      <div style={{ fontSize: 40 }}>⚠️</div>
      <div style={{ color: "#ff5555", fontWeight: 700, fontSize: 18 }}>เชื่อมต่อฐานข้อมูลไม่สำเร็จ</div>
      <div style={{ color: "#6b7ab5", fontSize: 13, background: "#ffffff", padding: "12px 20px", borderRadius: 8, fontFamily: "monospace", maxWidth: 500, wordBreak: "break-all" }}>{dbError}</div>
      <button onClick={loadAll} style={{ background: "#7c3aed", color: "#f0f2ff", border: "none", borderRadius: 8, padding: "10px 24px", fontWeight: 700, cursor: "pointer", fontSize: 15, fontFamily: "'Sarabun', sans-serif" }}>ลองใหม่</button>
    </div>
  );

  return (
    <div style={{ fontFamily: "'Sarabun', sans-serif", minHeight: "100vh", background: "#F8FAFC", color: "#111827" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #F1F5F9; } ::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 3px; }
        input, select, textarea { font-family: 'Sarabun', sans-serif; }

        .tab-btn { background: none; border: none; cursor: pointer; padding: 8px 16px; border-radius: 8px; font-family: 'Sarabun', sans-serif; font-size: 14px; transition: all 0.2s; color: rgba(255,255,255,0.7); }
        .tab-btn.active { background: rgba(255,255,255,0.2); color: #fff; font-weight: 600; }
        .tab-btn:hover:not(.active) { background: rgba(255,255,255,0.12); color: #fff; }

        .card { background: #ffffff; border: 1px solid #E5E7EB; border-radius: 20px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,0.05); }
        .btn { border: none; cursor: pointer; border-radius: 10px; font-family: 'Sarabun', sans-serif; font-weight: 600; transition: all 0.2s; font-size: 14px; }
        .btn-primary { background: linear-gradient(135deg,#7C3AED,#3B82F6); color: #fff; padding: 10px 22px; }
        .btn-primary:hover { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 4px 14px rgba(124,58,237,0.35); }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }
        .btn-danger { background: #FEF2F2; color: #DC2626; padding: 6px 12px; border: 1px solid #FECACA; border-radius: 8px; }
        .btn-danger:hover { background: #FEE2E2; }
        .btn-secondary { background: #fff; color: #7C3AED; padding: 7px 14px; border: 1.5px solid #DDD6FE; border-radius: 8px; }
        .btn-secondary:hover { background: #F5F3FF; }

        .inp { background: #F9FAFB; border: 1.5px solid #E5E7EB; border-radius: 10px; padding: 10px 14px; color: #111827; width: 100%; font-size: 14px; outline: none; transition: border 0.2s; }
        .inp:focus { border-color: #7C3AED; background: #fff; box-shadow: 0 0 0 3px rgba(124,58,237,0.08); }

        .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
        .badge-ok { background: #D1FAE5; color: #065F46; }
        .badge-low { background: #FEF3C7; color: #92400E; }
        .badge-out { background: #FEE2E2; color: #991B1B; }

        .overlay { position: fixed; inset: 0; background: rgba(17,24,39,0.45); z-index: 100; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(6px); }
        .modal { background: #fff; border: 1px solid #E5E7EB; border-radius: 24px; padding: 32px; width: 500px; max-width: 95vw; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.12); }

        .toast { position: fixed; bottom: 28px; right: 28px; z-index: 999; background: #fff; border: 1px solid #E5E7EB; border-radius: 14px; padding: 14px 22px; font-weight: 600; display: flex; align-items: center; gap: 10px; animation: slideIn 0.3s ease; box-shadow: 0 8px 24px rgba(0,0,0,0.1); color: #111827; }
        @keyframes slideIn { from { transform: translateX(60px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

        .stat-card { background: #fff; border: 1px solid #E5E7EB; border-radius: 16px; padding: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.05); }
        .stat-card::before { display: none; }
        .mono { font-family: 'Space Mono', monospace; }
        .tx-row { border-left: 3px solid; padding: 12px 16px; border-radius: 0 10px 10px 0; background: #FAFAFA; margin-bottom: 8px; }

        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 12px 16px; font-size: 11px; font-weight: 700; color: #7C3AED; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1.5px solid #EDE9FE; background: #FAFAFA; }
        td { padding: 13px 16px; border-bottom: 1px solid #F3F4F6; font-size: 14px; vertical-align: middle; color: #111827; }
        tr:hover td { background: #FAFAFE; }

        .label { font-size: 12px; color: #6B7280; margin-bottom: 6px; font-weight: 500; }
        .db-dot { width: 7px; height: 7px; background: #10B981; border-radius: 50%; display: inline-block; margin-right: 5px; animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes scanLine { from { transform: translateY(-40px); opacity: 0.6; } to { transform: translateY(40px); opacity: 1; } }

        .section-title { font-size: 22px; font-weight: 700; color: #111827; }
        .section-sub { font-size: 14px; color: #6B7280; margin-top: 4px; }
      `}</style>

      {/* HEADER — Gradient Nav */}
      <div style={{ background: "linear-gradient(135deg,#7C3AED 0%,#4F46E5 50%,#3B82F6 100%)", padding: "0 32px", boxShadow: "0 2px 12px rgba(124,58,237,0.25)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 38, height: 38, background: "rgba(255,255,255,0.2)", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, backdropFilter: "blur(4px)" }}>📦</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 17, color: "#fff", letterSpacing: "-0.3px" }}>StockMaster</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", display: "flex", alignItems: "center", gap: 4 }}>
                <span className="db-dot" style={{ background: "#10B981" }} />เชื่อมต่อ Supabase แล้ว
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 2 }}>
            {[["dashboard","ภาพรวม"],["inventory","สินค้าคงคลัง"],["transactions","รายการเคลื่อนไหว"],["returns","พัสดุตีกลับ"],["dispose","🗑️ จำหน่ายออก"]].map(([t,label]) => (
              <button key={t} className={`tab-btn ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>{label}</button>
            ))}
          </div>
          <button onClick={loadAll} style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", padding: "8px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Sarabun', sans-serif", backdropFilter: "blur(4px)" }}>
            🔄 รีเฟรช
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 28px" }}>

        {/* DASHBOARD */}
        {tab === "dashboard" && (
          <div>
            <div style={{ marginBottom: 28 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <h1 className="section-title">ภาพรวมคลังสินค้า</h1>
                  <p className="section-sub">อัปเดตล่าสุด: {new Date().toLocaleDateString("th-TH", { dateStyle: "long" })}</p>
                </div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16, marginBottom: 28 }}>
              {[
                { label: "มูลค่าสินค้าทั้งหมด", value: `฿${totalValue.toLocaleString("th-TH")}`, icon: "💰", color: "#7c3aed" },
                { label: "รายการสินค้า", value: `${products.length} รายการ`, icon: "🗂️", color: "#82aaff" },
                { label: "จำนวนชิ้นทั้งหมด", value: totalItems.toLocaleString("th-TH"), icon: "📦", color: "#c3e88d" },
                { label: "สินค้าใกล้หมด", value: `${lowStock.length} รายการ`, icon: "⚠️", color: "#ffa500" },
                { label: "ไม่เคลื่อนไหว 15 วัน", value: `${dormantProducts.length} รายการ`, icon: "😴", color: "#82aaff" },
              ].map((s, i) => (
                <div key={i} className="stat-card">
                  <div style={{ fontSize: 28, marginBottom: 12 }}>{s.icon}</div>
                  <div className="mono" style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ color: "#6b7ab5", marginTop: 4, fontSize: 14 }}>{s.label}</div>
                </div>
              ))}
            </div>
            {lowStock.length > 0 && (
              <div style={{ background: "#fff", border: "1.5px solid #FDE68A", borderRadius: 20, padding: 20, marginBottom: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <span style={{ fontSize: 20 }}>⚠️</span>
                  <h2 style={{ fontSize: 17, fontWeight: 700, color: "#ffa500" }}>สินค้าที่ต้องเติม ({lowStock.length} รายการ)</h2>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {lowStock.map(p => (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(255,165,0,0.05)", borderRadius: 10, padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        {p.imageUrl && <img src={p.imageUrl} style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover" }} />}
                        <div>
                          <div style={{ fontWeight: 600, color: "#1a1040" }}>{p.name}</div>
                          <div style={{ fontSize: 12, color: "#6b7ab5" }}>{p.sku}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div className={`badge ${p.quantity <= 0 ? "badge-out" : "badge-low"}`}>{p.quantity <= 0 ? "หมดสต็อก" : `เหลือ ${p.quantity} ${p.unit}`}</div>
                        <div style={{ fontSize: 12, color: "#6b7ab5", marginTop: 4 }}>ขั้นต่ำ: {p.minStock} {p.unit}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {dormantProducts.length > 0 && (
              <div style={{ background: "#fff", border: "1.5px solid #DDD6FE", borderRadius: 20, padding: 20, marginBottom: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 20 }}>😴</span>
                    <h2 style={{ fontSize: 17, fontWeight: 700, color: "#82aaff" }}>สินค้าไม่เคลื่อนไหว 15 วัน ({dormantProducts.length} รายการ)</h2>
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7ab5" }}>มูลค่ารวม ฿{dormantProducts.reduce((s,p)=>s+p.quantity*p.price,0).toLocaleString("th-TH")}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(showAllDormant ? dormantProducts : dormantProducts.slice(0, 5)).map(p => (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(130,130,180,0.05)", borderRadius: 10, padding: "10px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {p.imageUrl && <img src={p.imageUrl} style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover" }} />}
                        <div>
                          <div style={{ fontWeight: 600, color: "#1a1040", fontSize: 14 }}>{p.name}</div>
                          <div style={{ fontSize: 12, color: "#6b7ab5" }}>{p.sku}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "monospace", fontWeight: 700, color: "#82aaff" }}>{p.quantity} {p.unit}</div>
                        <div style={{ fontSize: 12, color: "#6b7ab5" }}>฿{(p.quantity*p.price).toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
                  {dormantProducts.length > 5 && (
                    <button onClick={() => setShowAllDormant(!showAllDormant)}
                      style={{ width: "100%", marginTop: 8, background: "transparent", border: "1px solid #DDD6FE", color: "#7C3AED", borderRadius: 8, padding: "8px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>
                      {showAllDormant ? "▲ ย่อรายการ" : `▼ ดูทั้งหมด ${dormantProducts.length} รายการ`}
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="card">
              <h2 style={{ fontSize: 17, fontWeight: 700, color: "#1a1040", marginBottom: 16 }}>รายการล่าสุด</h2>
              {transactions.length === 0 && <div style={{ color: "#6b7ab5", textAlign: "center", padding: 24 }}>ยังไม่มีรายการเคลื่อนไหว</div>}
              {transactions.slice(0, 5).map(tx => {
                const p = products.find(x => x.id === tx.productId);
                return (
                  <div key={tx.id} className="tx-row" style={{ borderColor: tx.type === "in" ? "#7c3aed" : "#ff5555" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <span style={{ fontWeight: 600, color: tx.type === "in" ? "#7c3aed" : "#ff5555", marginRight: 8 }}>{tx.type === "in" ? "▲ รับเข้า" : "▼ เบิกออก"}</span>
                        <span style={{ color: "#1a1040" }}>{p?.name}</span>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div className="mono" style={{ color: tx.type === "in" ? "#7c3aed" : "#ff5555", fontWeight: 700 }}>{tx.type === "in" ? "+" : "-"}{tx.quantity} {p?.unit}</div>
                        <div style={{ fontSize: 12, color: "#6b7ab5" }}>{tx.date} · {tx.by}</div>
                      </div>
                    </div>
                    {tx.note && <div style={{ fontSize: 13, color: "#6b7ab5", marginTop: 4 }}>📝 {tx.note}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* INVENTORY */}
        {tab === "inventory" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1a1040" }}>สินค้าคงคลัง <span style={{ fontSize: 14, color: "#6b7ab5", fontWeight: 400 }}>({filteredProducts.length} รายการ)</span></h1>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => { setTxType("in"); setShowModal("transaction"); }}>▲ รับสินค้า</button>
                <button className="btn btn-secondary" style={{ color: "#ff5555", borderColor: "rgba(255,85,85,0.3)", background: "rgba(255,85,85,0.05)" }} onClick={() => { setTxType("out"); setShowModal("transaction"); }}>▼ เบิกสินค้า</button>
                <button className="btn btn-secondary" onClick={handleExportInventory} disabled={exportingInventory}
                  style={{ color: "#7c3aed", borderColor: "rgba(124,58,237,0.3)", background: "rgba(100,255,218,0.05)" }}>
                  {exportingInventory ? "⏳..." : "📥 Export Excel"}
                </button>
                <button className="btn btn-primary" onClick={() => { setForm({}); setShowModal("add-product"); }}>+ เพิ่มสินค้า</button>
                <button onClick={() => { setDisposeMode(!disposeMode); setSelectedForDispose(new Set()); }}
                  style={{ background: disposeMode ? "#DC2626" : "#FEF2F2", color: disposeMode ? "#fff" : "#DC2626", border: "1.5px solid #FECACA", borderRadius: 10, padding: "9px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Sarabun', sans-serif", transition: "all 0.2s" }}>
                  {disposeMode ? "✕ ยกเลิก" : "🗑️ จำหน่ายออก"}
                </button>
              </div>
            </div>
            {disposeMode && (
              <div style={{ background: "#FEF2F2", border: "1.5px solid #FECACA", borderRadius: 14, padding: "14px 18px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, color: "#DC2626", fontSize: 15 }}>🗑️ โหมดจำหน่ายออก</div>
                  <div style={{ fontSize: 13, color: "#9B1C1C", marginTop: 3 }}>
                    ติ๊กเลือกสินค้าที่ต้องการตัดออก — เลือกแล้ว <span style={{ fontWeight: 700 }}>{selectedForDispose.size}</span> รายการ
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => {
                    if (selectedForDispose.size === filteredProducts.length) setSelectedForDispose(new Set());
                    else setSelectedForDispose(new Set(filteredProducts.map(p => p.id)));
                  }}
                    style={{ background: "#fff", border: "1px solid #FECACA", color: "#DC2626", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer", fontFamily: "'Sarabun', sans-serif", fontWeight: 600 }}>
                    {selectedForDispose.size === filteredProducts.length ? "ยกเลิกทั้งหมด" : "เลือกทั้งหมด"}
                  </button>
                  <button onClick={handleExportDispose} disabled={selectedForDispose.size === 0}
                    style={{ background: selectedForDispose.size > 0 ? "#FEF3C7" : "#F9FAFB", color: selectedForDispose.size > 0 ? "#92400E" : "#9CA3AF", border: "1px solid " + (selectedForDispose.size > 0 ? "#FDE68A" : "#E5E7EB"), borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: selectedForDispose.size > 0 ? "pointer" : "not-allowed", fontFamily: "'Sarabun', sans-serif" }}>
                    📥 Export รายงาน ({selectedForDispose.size})
                  </button>
                  <button onClick={handleConfirmDispose} disabled={selectedForDispose.size === 0}
                    style={{ background: selectedForDispose.size > 0 ? "#DC2626" : "#F9FAFB", color: selectedForDispose.size > 0 ? "#fff" : "#9CA3AF", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: selectedForDispose.size > 0 ? "pointer" : "not-allowed", fontFamily: "'Sarabun', sans-serif" }}>
                    🗑️ ลบออกจากระบบ ({selectedForDispose.size})
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              <input className="inp" style={{ flex: 1, minWidth: 200 }} placeholder="🔍 ค้นหาชื่อหรือ SKU..." value={search} onChange={e => setSearch(e.target.value)} />

              <select className="inp" style={{ width: "auto" }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option>ทั้งหมด</option>
                <option>ปกติ</option>
                <option>ใกล้หมด</option>
                <option>หมด</option>
                <option>ไม่เคลื่อนไหว</option>
              </select>
              {(statusFilter !== "ทั้งหมด" || categoryFilter !== "ทั้งหมด") && (
                <button className="btn" style={{ background: "rgba(255,85,85,0.08)", color: "#ff5555", border: "1px solid rgba(255,85,85,0.2)", padding: "8px 14px", fontSize: 13 }}
                  onClick={() => { setStatusFilter("ทั้งหมด"); setCategoryFilter("ทั้งหมด"); }}>
                  ✕ ล้างตัวกรอง
                </button>
              )}
            </div>
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 20, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>{disposeMode && <input type="checkbox" checked={selectedForDispose.size === filteredProducts.length && filteredProducts.length > 0} onChange={() => { if (selectedForDispose.size === filteredProducts.length) setSelectedForDispose(new Set()); else setSelectedForDispose(new Set(filteredProducts.map(p => p.id))); }} style={{ cursor: "pointer", width: 16, height: 16, accentColor: "#DC2626" }} />}</th>
                    <th style={{ width: 36 }}></th>
                    <th style={{ width: 60 }}>รูป</th>
                    <SortTh col="sku" label="SKU" />
                    <SortTh col="name" label="ชื่อสินค้า" />

                    <SortTh col="quantity" label="คงเหลือ" />
                    <th>สถานะ</th>
                    <SortTh col="price" label="ราคาทุน" />
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map(p => {
                    const status = p.quantity <= 0 ? "out" : (p.minStock > 0 && p.quantity <= p.minStock) ? "low" : "ok";
                    return (
                      <tr key={p.id} style={{ background: disposeMode && selectedForDispose.has(p.id) ? "#FEF2F2" : pinnedIds.includes(String(p.id)) ? "rgba(124,58,237,0.04)" : undefined }}>
                        <td style={{ textAlign: "center" }}>
                          {disposeMode ? (
                            <input type="checkbox" checked={selectedForDispose.has(p.id)} onChange={() => toggleDispose(p.id)}
                              style={{ cursor: "pointer", width: 16, height: 16, accentColor: "#DC2626" }} />
                          ) : null}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <button onClick={() => togglePin(p.id)} title={pinnedIds.includes(p.id) ? "ถอนหมุด" : "ปักหมุด"}
                            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, padding: "2px", opacity: pinnedIds.includes(String(p.id)) ? 1 : 0.2, transition: "opacity 0.15s", lineHeight: 1 }}
                            onMouseEnter={e => e.currentTarget.style.opacity = "1"}
                            onMouseLeave={e => e.currentTarget.style.opacity = pinnedIds.includes(String(p.id)) ? "1" : "0.2"}>
                            📌
                          </button>
                        </td>
                        <td>
                          <label style={{ cursor: "pointer", display: "block" }}>
                            <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => e.target.files[0] && handleImageUpload(p, e.target.files[0])} />
                            {p.imageUrl
                              ? <img src={p.imageUrl} alt={p.name} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8, border: "1px solid #2a2f45" }} />
                              : <div style={{ width: 44, height: 44, borderRadius: 8, border: "2px dashed #2a2f45", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#c0c4da", background: "#ffffff" }}>📷</div>
                            }
                          </label>
                        </td>
                        <td><span className="mono" style={{ color: "#6b7ab5", fontSize: 12 }}>{p.sku}</span></td>
                        <td>
                          <span onClick={() => { setFilterProductId(p.id); setTab("transactions"); }}
                            style={{ fontWeight: 600, color: "#7C3AED", cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}
                            title="กดเพื่อดูประวัติการเคลื่อนไหว">
                            {p.name}
                          </span>
                        </td>

                        <td className="mono" style={{ fontWeight: 700, color: p.quantity < 0 ? "#ff5555" : undefined }}>{p.quantity} <span style={{ color: "#6b7ab5", fontSize: 12, fontWeight: 400 }}>{p.unit}</span></td>
                        <td><span className={`badge badge-${status}`}>{status === "ok" ? "✓ ปกติ" : status === "low" ? "⚠ ใกล้หมด" : "✗ หมด"}</span></td>
                        <td className="mono" style={{ color: "#c3e88d" }}>฿{p.price.toLocaleString()}</td>
                        <td>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button className="btn btn-secondary" style={{ fontSize: 12, padding: "5px 10px" }} onClick={() => openEdit(p)}>แก้ไข</button>
                            <button className="btn btn-danger" style={{ fontSize: 12 }} onClick={() => handleDeleteProduct(p.id)}>ลบ</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredProducts.length === 0 && <div style={{ textAlign: "center", padding: 48, color: "#6b7ab5" }}>ไม่พบสินค้าที่ค้นหา</div>}
            </div>
          </div>
        )}

        {/* RETURNS */}
        {tab === "returns" && (
          <div>
            <ReturnCheckerTab />
          </div>
        )}

        {/* TRANSACTIONS */}
        {tab === "dispose" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
              <div>
                <h1 className="section-title">ประวัติการจำหน่ายออก</h1>
                <p className="section-sub">รายการสินค้าที่ถูกตัดออกจากระบบ</p>
              </div>
              <button onClick={loadDisposeRecords}
                style={{ background: "#fff", border: "1px solid #E5E7EB", color: "#6B7280", borderRadius: 10, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>
                🔄 โหลดข้อมูล
              </button>
            </div>

            {disposeRecords.length === 0 && !loadingDispose && (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "#9CA3AF" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🗑️</div>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>ยังไม่มีประวัติการจำหน่ายออก</div>
                <div style={{ fontSize: 14 }}>กด "โหลดข้อมูล" เพื่อดึงข้อมูลจากระบบ</div>
              </div>
            )}

            {loadingDispose && <div style={{ textAlign: "center", padding: 40, color: "#6B7280" }}>กำลังโหลด...</div>}

            {disposeRecords.length > 0 && (
              <div>
                {/* Summary */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 24 }}>
                  {[
                    { label: "รายการทั้งหมด", value: `${disposeRecords.length} รายการ`, color: "#6B7280", bg: "#F9FAFB" },
                    { label: "มูลค่ารวมที่ตัดออก", value: `฿${disposeRecords.reduce((s,r)=>s+(r.total_value||0),0).toLocaleString("th-TH")}`, color: "#DC2626", bg: "#FEF2F2" },
                  ].map((s,i) => (
                    <div key={i} style={{ background: s.bg, border: "1px solid #E5E7EB", borderRadius: 14, padding: "16px 20px" }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: 13, color: "#6B7280", marginTop: 4 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Search */}
                <input className="inp" style={{ marginBottom: 16 }} placeholder="🔍 ค้นหาชื่อสินค้าหรือ SKU..."
                  value={disposeSearch} onChange={e => setDisposeSearch(e.target.value)} />

                {/* Table */}
                <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, overflow: "hidden" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>วันที่จำหน่ายออก</th>
                        <th>SKU</th>
                        <th>ชื่อสินค้า</th>
                        <th>คงเหลือสุดท้าย</th>
                        <th>มูลค่า (฿)</th>
                        <th>ผู้ทำรายการ</th>
                        <th>หมายเหตุ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {disposeRecords
                        .filter(r => !disposeSearch || r.name?.toLowerCase().includes(disposeSearch.toLowerCase()) || r.sku?.toLowerCase().includes(disposeSearch.toLowerCase()))
                        .map((r, i) => (
                        <tr key={i}>
                          <td style={{ fontSize: 13, color: "#6B7280", whiteSpace: "nowrap" }}>
                            {r.disposed_at ? new Date(r.disposed_at).toLocaleDateString("th-TH", { dateStyle: "medium" }) : "-"}
                            <div style={{ fontSize: 11, color: "#9CA3AF" }}>
                              {r.disposed_at ? new Date(r.disposed_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : ""}
                            </div>
                          </td>
                          <td style={{ fontFamily: "monospace", fontSize: 12, color: "#6B7280" }}>{r.sku}</td>
                          <td style={{ fontWeight: 600, color: "#111827" }}>{r.name}</td>
                          <td style={{ fontFamily: "monospace", color: r.final_quantity < 0 ? "#DC2626" : "#111827", fontWeight: 700 }}>
                            {r.final_quantity} {r.unit}
                          </td>
                          <td style={{ fontFamily: "monospace", color: "#DC2626", fontWeight: 600 }}>
                            ฿{(r.total_value || 0).toLocaleString("th-TH")}
                          </td>
                          <td style={{ color: "#374151" }}>{r.disposed_by || "-"}</td>
                          <td style={{ fontSize: 13, color: "#6B7280" }}>{r.note || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "transactions" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
              <div>
                <h1 className="section-title">รายการเคลื่อนไหวสินค้า</h1>
                {filterProductId && (() => {
                  const fp = products.find(p => p.id === filterProductId);
                  return fp ? <div style={{ fontSize: 13, color: "#7C3AED", marginTop: 4, fontWeight: 600 }}>กรอง: {fp.name}</div> : null;
                })()}
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {filterProductId && (
                  <button onClick={() => setFilterProductId(null)}
                    style={{ background: "#EDE9FE", color: "#7C3AED", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>
                    ✕ ล้างตัวกรอง (ดูทั้งหมด)
                  </button>
                )}
                <button className="btn btn-secondary" onClick={() => { setTxType("in"); setShowModal("transaction"); }}>▲ รับสินค้า</button>
                <button className="btn btn-secondary" style={{ color: "#ff5555", borderColor: "rgba(255,85,85,0.3)", background: "rgba(255,85,85,0.05)" }} onClick={() => { setTxType("out"); setShowModal("transaction"); }}>▼ เบิกสินค้า</button>
              </div>
            </div>
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <table>
                <thead><tr><th>วันที่</th><th>ประเภท</th><th>สินค้า</th><th>จำนวน</th><th>หมายเหตุ</th><th>ผู้ดำเนินการ</th></tr></thead>
                <tbody>
                  {(filterProductId ? transactions.filter(tx => tx.productId === filterProductId) : transactions).map(tx => {
                    const p = products.find(x => x.id === tx.productId);
                    return (
                      <tr key={tx.id}>
                        <td className="mono" style={{ color: "#6b7ab5", fontSize: 13 }}>{tx.date}</td>
                        <td><span className={`badge ${tx.type === "in" ? "badge-ok" : "badge-out"}`}>{tx.type === "in" ? "▲ รับเข้า" : "▼ เบิกออก"}</span></td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {p?.imageUrl && <img src={p.imageUrl} style={{ width: 28, height: 28, borderRadius: 4, objectFit: "cover" }} />}
                            <div>
                              <div style={{ fontWeight: 500, color: "#1a1040" }}>{p?.name || "ไม่ทราบ"}</div>
                              <div style={{ fontSize: 12, color: "#6b7ab5" }}>{p?.sku}</div>
                            </div>
                          </div>
                        </td>
                        <td className="mono" style={{ fontWeight: 700, color: tx.type === "in" ? "#7c3aed" : "#ff5555" }}>{tx.type === "in" ? "+" : "-"}{tx.quantity} {p?.unit}</td>
                        <td style={{ color: "#6b7ab5", fontSize: 14 }}>{tx.note || "-"}</td>
                        <td style={{ color: "#1a1040" }}>{tx.by}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {transactions.length === 0 && <div style={{ textAlign: "center", padding: 48, color: "#6b7ab5" }}>ยังไม่มีรายการเคลื่อนไหว</div>}
            </div>
          </div>
        )}
      </div>

      {/* MODALS */}
      {(showModal === "add-product" || showModal === "edit") && (
        <div className="overlay" onClick={() => setShowModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1a1040", marginBottom: 20 }}>
              {showModal === "edit" ? "✏️ แก้ไขสินค้า" : "📦 เพิ่มสินค้าใหม่"}
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <div className="label">SKU / รหัสสินค้า</div>
                <input className="inp" value={form.sku || ""} onChange={e => setForm({ ...form, sku: e.target.value })} />
              </div>

              <div style={{ gridColumn: "1/-1" }}>
                <div className="label">ชื่อสินค้า</div>
                <input className="inp" value={form.name || ""} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <div className="label">จำนวนคงเหลือ</div>
                <input className="inp" type="number" value={form.quantity || ""} onChange={e => setForm({ ...form, quantity: e.target.value })} />
              </div>
              <div>
                <div className="label">สต็อกขั้นต่ำ</div>
                <input className="inp" type="number" value={form.minStock || ""} onChange={e => setForm({ ...form, minStock: e.target.value })} />
              </div>
              <div>
                <div className="label">ราคาทุน/หน่วย (฿)</div>
                <input className="inp" type="number" value={form.price || ""} onChange={e => setForm({ ...form, price: e.target.value })} />
              </div>
              <div>
                <div className="label">หน่วยนับ</div>
                <input className="inp" value={form.unit || ""} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="ชิ้น, กล่อง, อัน" />
              </div>
              <div>
                <div className="label">ที่เก็บ</div>
                <input className="inp" value={form.location || ""} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="เช่น A-01" />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 22, justifyContent: "flex-end" }}>
              <button className="btn" style={{ background: "#f0f2ff", color: "#6b7ab5", padding: "10px 20px" }} onClick={() => setShowModal(null)}>ยกเลิก</button>
              <button className="btn btn-primary" disabled={saving} onClick={showModal === "edit" ? handleEditProduct : handleAddProduct}>
                {saving ? "กำลังบันทึก..." : showModal === "edit" ? "บันทึก" : "เพิ่มสินค้า"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal === "transaction" && (
        <div className="overlay" onClick={() => setShowModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
              {[["in","▲ รับสินค้าเข้า"],["out","▼ เบิกสินค้าออก"]].map(([t, l]) => (
                <button key={t} className="btn" style={{ flex: 1, padding: "10px", background: txType === t ? (t === "in" ? "rgba(124,58,237,0.15)" : "rgba(255,85,85,0.15)") : "#f0f2ff", color: t === "in" ? "#7c3aed" : "#ff5555", border: `1px solid ${txType === t ? (t === "in" ? "#7c3aed" : "#ff5555") : "#d4d8f0"}`, fontWeight: 700 }} onClick={() => setTxType(t)}>{l}</button>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ position: "relative" }}>
                <div className="label">สินค้า</div>
                {(() => {
                  const selected = products.find(p => String(p.id) === String(txForm.productId));
                  return (
                    <div>
                      <input className="inp" placeholder="พิมพ์ชื่อสินค้าเพื่อค้นหา..."
                        value={txForm._productSearch !== undefined ? txForm._productSearch : (selected ? selected.name : "")}
                        onChange={e => setTxForm({ ...txForm, _productSearch: e.target.value, productId: "" })}
                        onFocus={e => setTxForm(f => ({ ...f, _productSearch: f._productSearch !== undefined ? f._productSearch : (selected ? selected.name : ""), _showDrop: true }))}
                        onBlur={() => setTimeout(() => setTxForm(f => ({ ...f, _showDrop: false })), 150)}
                        autoComplete="off"
                      />
                      {txForm._showDrop && (() => {
                        const q = (txForm._productSearch || "").toLowerCase();
                        const filtered = products.filter(p =>
                          p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
                        ).slice(0, 30);
                        return filtered.length > 0 ? (
                          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "#ffffff", border: "1px solid #2a2f45", borderRadius: 8, maxHeight: 240, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
                            {filtered.map(p => (
                              <div key={p.id}
                                onMouseDown={() => setTxForm(f => ({ ...f, productId: String(p.id), _productSearch: p.name, _showDrop: false }))}
                                style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid #1e2235", fontSize: 14 }}
                                onMouseEnter={e => e.currentTarget.style.background = "rgba(124,58,237,0.08)"}
                                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                              >
                                <span style={{ color: "#1a1040", fontWeight: 500 }}>{p.name}</span>
                                <span style={{ color: "#9ba3c7", fontSize: 12, marginLeft: 8 }}>{p.sku}</span>
                                <span style={{ float: "right", color: p.quantity <= 0 ? "#ff5555" : "#7c3aed", fontSize: 12, fontFamily: "monospace" }}>
                                  {p.quantity} {p.unit}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : q ? (
                          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "#ffffff", border: "1px solid #2a2f45", borderRadius: 8, padding: "12px 14px", color: "#9ba3c7", fontSize: 13 }}>
                            ไม่พบสินค้า "{txForm._productSearch}"
                          </div>
                        ) : null;
                      })()}
                    </div>
                  );
                })()}
              </div>
              <div>
                <div className="label">จำนวน</div>
                <input className="inp" type="number" min="1" value={txForm.quantity} onChange={e => setTxForm({ ...txForm, quantity: e.target.value })} />
              </div>
              <div>
                <div className="label">ผู้ดำเนินการ</div>
                <input className="inp" value={txForm.by} onChange={e => setTxForm({ ...txForm, by: e.target.value })} placeholder="ชื่อ-นามสกุล" />
              </div>
              <div>
                <div className="label">หมายเหตุ (ถ้ามี)</div>
                <input className="inp" value={txForm.note} onChange={e => setTxForm({ ...txForm, note: e.target.value })} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 22, justifyContent: "flex-end" }}>
              <button className="btn" style={{ background: "#f0f2ff", color: "#6b7ab5", padding: "10px 20px" }} onClick={() => setShowModal(null)}>ยกเลิก</button>
              <button className="btn btn-primary" disabled={saving} style={{ background: txType === "out" ? "#ff5555" : "#7c3aed", color: "#f0f2ff" }} onClick={handleTransaction}>
                {saving ? "กำลังบันทึก..." : txType === "in" ? "รับสินค้าเข้า" : "เบิกสินค้าออก"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" style={{ borderColor: toast.type === "error" ? "rgba(255,85,85,0.4)" : "rgba(124,58,237,0.3)", color: toast.type === "error" ? "#ff5555" : "#7c3aed" }}>
          <span>{toast.type === "error" ? "❌" : "✅"}</span>
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}
