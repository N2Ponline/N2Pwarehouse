import { useState, useEffect, useCallback, useRef, useMemo } from "react";

const SUPABASE_URL = "https://slwbzbnomsugffyzjyuv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNsd2J6Ym5vbXN1Z2ZmeXpqeXV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjIxMDcsImV4cCI6MjA5NTI5ODEwN30.qG3CPT6J_evddK8qmpF7P3bVswn_Du43MEHo33bUnqA";

const sb = async (path, opts = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      ...opts.headers,
Prefer: opts.headers?.Prefer || opts.prefer || "return=representation",
    },
    ...opts,
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


function ReturnAdminPanel() {
  const [flashText, setFlashText] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [dateFilter, setDateFilter] = useState(""); // YYYY-MM-DD
  const [scansCache, setScansCache] = useState({}); // id -> [{tracking_code, scanned_by, scanned_at}]
  const [loadingScans, setLoadingScans] = useState(null); // session id loading

  const loadScans = async (sessionId) => {
    if (scansCache[sessionId]) return; // already cached
    setLoadingScans(sessionId);
    try {
      const data = await sbReturnAll("return_scans", `session_id=eq.${sessionId}&select=tracking_code,scanned_by,scanned_at&order=scanned_at.asc`);
      setScansCache(prev => ({ ...prev, [sessionId]: data }));
    } catch (e) { console.error(e); }
    setLoadingScans(null);
  };

  const handleExport = async () => {
    if (sessions.length === 0) return alert("ไม่มีเซสชันให้ export");
    setExporting(true);
    try { await exportReport(sessions); }
    catch (e) { alert("Export ไม่สำเร็จ: " + e.message); }
    setExporting(false);
  };

  const fetchSessions = async (date = dateFilter) => {
    try {
      let filter = "select=*,return_scans(count)&order=created_at.desc";
      if (date) filter += `&created_at=gte.${date}T00:00:00&created_at=lte.${date}T23:59:59`;
      const data = await sbReturnAll("return_sessions", filter);
      setSessions(data);
    } catch (e) { console.error(e); }
    setLoadingSessions(false);
  };

  useEffect(() => { fetchSessions(dateFilter); }, [dateFilter]);

  const handleCreate = async () => {
    const list = parseFlashText(flashText);
    if (!list.length) return alert("ไม่พบเลข tracking กรุณาตรวจสอบข้อความ");
    setLoading(true);
    try {
      // Supabase array column รองรับข้อมูลใหญ่ได้ แต่ถ้าเกิน 5000 ให้แจ้งเตือน
      if (list.length > 5000) {
        if (!confirm(`พบ ${list.length.toLocaleString()} รายการ (มากกว่าปกติ) ยืนยันสร้างเซสชันนี้?`)) {
          setLoading(false); return;
        }
      }
      await sbReturn("return_sessions", { method: "POST", body: JSON.stringify({ tracking_list: list, courier: "Flash" }) });
      setFlashText("");
      fetchSessions();
    } catch (e) { alert("เกิดข้อผิดพลาด: " + JSON.stringify(e)); }
    setLoading(false);
  };

  const preview = parseFlashText(flashText);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1a1040", marginBottom: 6 }}>ตีกลับในระบบ — ลงรายการจาก Flash</h2>
        <p style={{ color: "#6b7ab5", fontSize: 14 }}>Copy ข้อความจากหน้า Flash Express แล้ววางด้านล่าง เพื่อชนกับรายการที่คลังรับเข้า</p>
      </div>
      <textarea value={flashText} onChange={e => setFlashText(e.target.value)}
        placeholder="วางข้อความจาก Flash Express ที่นี่...&#10;รองรับทุก format เช่น TH27218RHRH38A 15:02/TH27218RJD230A 15:11/..."
        style={{ width: "100%", height: 180, background: "rgba(255,255,255,0.82)", border: "1.5px solid rgba(124,58,237,0.16)", borderRadius: 14, padding: 16, color: "#11143d", fontSize: 13, resize: "vertical", outline: "none", lineHeight: 1.8, fontFamily: "'Sarabun', sans-serif", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8), 0 10px 26px rgba(79,70,229,0.06)" }} />
      {flashText.trim() && (
        <div style={{ marginTop: 8, fontSize: 13, color: "#6b7ab5" }}>
          พบเลข tracking <span style={{ color: "#7c3aed", fontWeight: 700 }}>{preview.length}</span> รายการ
        </div>
      )}
      <button onClick={handleCreate} disabled={!flashText.trim() || loading}
        style={{ marginTop: 14, background: flashText.trim() && !loading ? "linear-gradient(135deg,#7c3aed,#3b82f6)" : "#ffffff", color: flashText.trim() && !loading ? "#ffffff" : "#aab0cc", border: "1px solid rgba(124,58,237,0.14)", borderRadius: 12, padding: "12px 28px", fontSize: 15, fontWeight: 700, cursor: flashText.trim() ? "pointer" : "not-allowed", fontFamily: "'Sarabun', sans-serif", boxShadow: flashText.trim() && !loading ? "0 14px 28px rgba(79,70,229,0.22)" : "none" }}>
        {loading ? "กำลังสร้าง..." : "✅ สร้างเซสชัน"}
      </button>

      <div style={{ marginTop: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontSize: 13, color: "#6b7ab5", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
            เซสชัน {dateFilter ? `วันที่ ${new Date(dateFilter).toLocaleDateString("th-TH")}` : "ทั้งหมด"} ({sessions.length} เซสชัน)
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)}
              style={{ background: "rgba(255,255,255,0.86)", border: "1px solid rgba(124,58,237,0.16)", borderRadius: 10, padding: "7px 12px", color: "#11143d", fontSize: 13, outline: "none", fontFamily: "'Sarabun', sans-serif", cursor: "pointer", boxShadow: "0 6px 16px rgba(79,70,229,0.06)" }} />
            {dateFilter && <button onClick={() => setDateFilter("")} style={{ background: "rgba(255,255,255,0.76)", border: "1px solid rgba(124,58,237,0.16)", color: "#6b7ab5", borderRadius: 10, padding: "7px 12px", fontSize: 13, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>✕ ล้าง</button>}
          </div>
        </div>
        {loadingSessions && <div style={{ color: "#9ba3c7", fontSize: 14 }}>กำลังโหลด...</div>}
        {!loadingSessions && sessions.length === 0 && <div style={{ color: "#aab0cc", fontSize: 14 }}>ยังไม่มีเซสชัน</div>}
        {sessions.map(s => {
          const scannedCount = s.return_scans?.[0]?.count ?? 0;
          const total = s.tracking_list?.length ?? 0;
          const pct = total > 0 ? Math.round((scannedCount / total) * 100) : 0;
          const isExpanded = expandedId === s.id;
          return (
            <div key={s.id} style={{ background: "rgba(255,255,255,0.86)", border: "1px solid rgba(124,58,237,0.14)", borderRadius: 14, marginBottom: 12, overflow: "hidden", boxShadow: "0 10px 26px rgba(79,70,229,0.08)", backdropFilter: "blur(12px)" }}>
              <div style={{ padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ cursor: "pointer", flex: 1 }} onClick={() => { const next = isExpanded ? null : s.id; setExpandedId(next); if (next) loadScans(next); }}>
                    <span style={{ fontWeight: 600, color: "#1a1040", fontSize: 14 }}>{s.courier} — {new Date(s.created_at).toLocaleDateString("th-TH", { dateStyle: "medium" })}</span>
                    <span style={{ marginLeft: 10, color: "#6b7ab5", fontSize: 12 }}>{new Date(s.created_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontFamily: "monospace", fontSize: 13, color: pct === 100 ? "#7c3aed" : "#1a1040" }}>{scannedCount}/{total}</span>
                    <button onClick={() => exportToCSV(`session_${s.id}_${new Date(s.created_at).toISOString().slice(0,10)}.csv`, ["tracking_number", ...(s.tracking_list || [])])}
                      style={{ background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.2)", color: "#7c3aed", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>
                      📥 Excel
                    </button>
                    <span style={{ color: "#9ba3c7", cursor: "pointer", fontSize: 14 }} onClick={() => { const next = isExpanded ? null : s.id; setExpandedId(next); if (next) loadScans(next); }}>{isExpanded ? "▲" : "▼"}</span>
                  </div>
                </div>
                <div style={{ height: 7, background: "rgba(124,58,237,0.10)", borderRadius: 999 }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: pct === 100 ? "linear-gradient(90deg,#22c55e,#4fd1c5)" : "linear-gradient(90deg,#7c3aed,#3b82f6)", borderRadius: 999 }} />
                </div>
              </div>
              {isExpanded && (
                <div style={{ borderTop: "1px solid rgba(124,58,237,0.12)", background: "rgba(248,250,255,0.62)" }}>
                  {/* Sub-tabs */}
                  {(() => {
                    const scans = scansCache[s.id] || [];
                    const scannedSet = new Set(scans.map(x => x.tracking_code));
                    return (
                      <div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
                          {/* Left: ระบบแจ้ง */}
                          <div style={{ padding: "12px 14px", borderRight: "1px solid rgba(124,58,237,0.12)", maxHeight: 260, overflowY: "auto" }}>
                            <div style={{ fontSize: 11, color: "#6b7ab5", fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                              📋 แจ้งจากระบบ ({total})
                            </div>
                            {(s.tracking_list || []).map((code, i) => {
                              const ok = scannedSet.has(code);
                              const scan = scans.find(x => x.tracking_code === code);
                              return (
                                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid rgba(124,58,237,0.08)" }}>
                                  <span style={{ fontFamily: "monospace", fontSize: 11, color: ok ? "#7c3aed" : "#ff5555" }}>{code}</span>
                                  <span style={{ fontSize: 11, color: ok ? "#7c3aed" : "#9ba3c7" }}>
                                    {ok ? `✓ ${scan?.scanned_by || ""}` : "รอรับ"}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                          {/* Right: พนักงานยิง */}
                          <div style={{ padding: "12px 14px", maxHeight: 260, overflowY: "auto" }}>
                            <div style={{ fontSize: 11, color: "#6b7ab5", fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                              📦 พนักงานยิง ({scans.length})
                              {loadingScans === s.id && <span style={{ color: "#9ba3c7", marginLeft: 8 }}>กำลังโหลด...</span>}
                            </div>
                            {scans.length === 0 && loadingScans !== s.id && <div style={{ color: "#aab0cc", fontSize: 12 }}>ยังไม่มีการยิง</div>}
                            {scans.map((sc, i) => {
                              const inList = (s.tracking_list || []).includes(sc.tracking_code);
                              return (
                                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid rgba(124,58,237,0.08)" }}>
                                  <span style={{ fontFamily: "monospace", fontSize: 11, color: inList ? "#7c3aed" : "#ffa500" }}>{sc.tracking_code}</span>
                                  <div style={{ textAlign: "right" }}>
                                    <div style={{ fontSize: 11, color: "#1a1040" }}>{sc.scanned_by || "-"}</div>
                                    <div style={{ fontSize: 10, color: "#9ba3c7" }}>{sc.scanned_at ? new Date(sc.scanned_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : ""}</div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button onClick={fetchSessions} style={{ background: "rgba(255,255,255,0.76)", border: "1px solid rgba(124,58,237,0.16)", color: "#6b7ab5", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>🔄 โหลดใหม่</button>
          <button onClick={handleExport} disabled={exporting || sessions.length === 0}
            style={{ background: sessions.length > 0 && !exporting ? "rgba(124,58,237,0.1)" : "#ffffff", border: `1px solid ${sessions.length > 0 ? "rgba(124,58,237,0.3)" : "#d4d8f0"}`, color: sessions.length > 0 && !exporting ? "#7c3aed" : "#aab0cc", borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: sessions.length > 0 ? "pointer" : "not-allowed", fontFamily: "'Sarabun', sans-serif" }}>
            {exporting ? "⏳ กำลัง Export..." : "📊 Export รายงาน Excel (ทุกเซสชัน)"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReturnStaffPanel() {
  const [staffName, setStaffName] = useState(localStorage.getItem("staffName") || "");
  const [mode, setMode] = useState("idle"); // idle | scanning
  const [staging, setStaging] = useState([]); // [{code, time}] local only
  const [submitted, setSubmitted] = useState([]); // [{code, by, at}] saved to DB
  const [systemList, setSystemList] = useState([]);
  const [scanInput, setScanInput] = useState("");
  const [lastScan, setLastScan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const scanRef = useRef(null);
  const listRef = useRef(null);
  // สแกนบาร์โค้ด ใช้ ZXing WASM (รองรับทุก browser รวมถึง iPhone)
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const scannerRef = useRef(null);
  const scannerDivId = "qr-scanner-div";
  const lastScannedRef = useRef("");
  const lastScannedTime = useRef(0);

  const loadHtml5Qr = () => new Promise((resolve, reject) => {
    if (window.Html5Qrcode) { resolve(); return; }
    const s = document.createElement("script");
    s.src = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("โหลดไม่สำเร็จ"));
    document.head.appendChild(s);
  });

  // ใช้ ref เก็บ staging codes ล่าสุดเพื่อให้ handleScanned อ่านได้โดยไม่ stale closure
  const stagingCodesRef = useRef([]);
  const submittedCodesRef = useRef([]);

  // sync ref ทุกครั้งที่ state เปลี่ยน
  useEffect(() => { stagingCodesRef.current = staging.map(s => s.code); }, [staging]);
  useEffect(() => { submittedCodesRef.current = submitted.map(s => s.tracking_code); }, [submitted]);

  const handleScanned = (code) => {
    code = code.trim().toUpperCase();
    if (!code) return;
    // debounce เลขเดิมภายใน 1.5 วินาที (ป้องกัน scanner ยิงซ้ำเร็วเกิน)
    const now = Date.now();
    if (code === lastScannedRef.current && now - lastScannedTime.current < 1500) return;
    lastScannedRef.current = code;
    lastScannedTime.current = now;
    // ตรวจสอบซ้ำจาก ref (ไม่ stale)
    const allCodes = [...stagingCodesRef.current, ...submittedCodesRef.current];
    if (allCodes.includes(code)) {
      playBeep(false);
      setLastScan({ code, status: "duplicate" });
      return;
    }
    const timeStr = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setStaging(prev => [{ code, time: timeStr }, ...prev]);
    setLastScan({ code, status: systemList.includes(code) ? "match" : "extra" });
    playBeep(systemList.includes(code));
  };

  const openCamera = async () => {
    setCameraLoading(true);
    try {
      await loadHtml5Qr();
      setCameraOpen(true);
      // รอให้ div render ก่อน
      await new Promise(r => setTimeout(r, 200));
      const scanner = new window.Html5Qrcode(scannerDivId);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 15, qrbox: { width: 280, height: 120 }, aspectRatio: 1.8,
          formatsToSupport: [
            window.Html5QrcodeSupportedFormats?.CODE_128,
            window.Html5QrcodeSupportedFormats?.CODE_39,
            window.Html5QrcodeSupportedFormats?.EAN_13,
            window.Html5QrcodeSupportedFormats?.EAN_8,
            window.Html5QrcodeSupportedFormats?.QR_CODE,
          ].filter(Boolean)
        },
        handleScanned,
        () => {}
      );
    } catch (err) {
      console.error(err);
      setCameraOpen(false);
      alert("เปิดกล้องไม่ได้ กรุณาอนุญาต permission กล้องในการตั้งค่าเบราว์เซอร์");
    }
    setCameraLoading(false);
  };

  const closeCamera = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {}
      scannerRef.current = null;
    }
    setCameraOpen(false);
  };

  useEffect(() => { return () => { closeCamera(); }; }, []);
  const today = new Date().toISOString().slice(0,10);

  useEffect(() => { if (staffName) loadData(); }, [staffName]);
  useEffect(() => { if (mode === "scanning" && scanRef.current) scanRef.current.focus(); }, [mode]);

  const loadData = async () => {
    setLoading(true);
    try {
      const sessions = await sbReturnAll("return_sessions", `select=*&created_at=gte.${today}T00:00:00&created_at=lte.${today}T23:59:59`);
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

  const handleScan = (e) => {
    if (e.key !== "Enter") return;
    const code = scanInput.trim().toUpperCase();
    if (!code) return;
    setScanInput("");
    const allCodes = [...staging.map(s=>s.code), ...submitted.map(s=>s.tracking_code)];
    if (allCodes.includes(code)) {
      setLastScan({ code, status: "duplicate" }); playBeep(false); return;
    }
    const now = new Date();
    const timeStr = now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const newEntry = { code, time: timeStr };
    // ขึ้นบนสุด (รายการล่าสุด = บนสุด)
    setStaging(prev => [newEntry, ...prev]);
    setLastScan({ code, status: systemList.includes(code) ? "match" : "extra" });
    playBeep(systemList.includes(code));
    // scroll list to top
    setTimeout(() => { if (listRef.current) listRef.current.scrollTop = 0; }, 50);
  };

  const removeFromStaging = (code) => {
    setStaging(prev => prev.filter(s => s.code !== code));
    if (lastScan?.code === code) setLastScan(null);
  };

  const handleConfirm = async () => {
    if (staging.length === 0) return;
    setSaving(true);
    try {
      const sessions = await sbReturnAll("return_sessions", `select=id,tracking_list&created_at=gte.${today}T00:00:00&created_at=lte.${today}T23:59:59`);
      const fallbackId = sessions[0]?.id ?? null;
      const now = new Date().toISOString();
      for (const entry of staging) {
        const target = sessions.find(s => (s.tracking_list||[]).includes(entry.code));
        const sid = target?.id || fallbackId;
        if (sid) {
          try {
            await sbReturn("return_scans", { method: "POST", body: JSON.stringify({
              tracking_code: entry.code,
              session_id: sid,
              scanned_by: staffName,
              scanned_at: now,
            })});
          } catch {}
        }
      }
      // prepend to submitted (newest first)
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
      const HEADER = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1A3C5E" } } };
      const GREEN = { fill: { fgColor: { rgb: "C6EFCE" } } };
      const RED   = { fill: { fgColor: { rgb: "FFCCCC" } } };
      const ORANGE= { fill: { fgColor: { rgb: "FFE0B2" } } };
      const wb = XLSX.utils.book_new();
      const pct = systemList.length > 0 ? Math.round(matched.length/systemList.length*100) : 0;
      // Sheet 1: สรุป
      const ws1 = XLSX.utils.aoa_to_sheet([
        [{ v: "สรุปรายงานพัสดุตีกลับ", s: { font: { bold: true, sz: 14 } } }, ""],
        ["วันที่ตีกลับ", dateStr], ["ผู้ยิงบาร์โค้ด", staffName], ["", ""],
        [{ v: "หัวข้อ", s: HEADER }, { v: "จำนวน", s: HEADER }],
        ["1. ตีกลับในระบบ", systemList.length],
        ["2. ตีกลับถึงคลัง", submitted.length],
        ["3. ✓ ตรงกัน", matched.length],
        [{ v: "4. ✗ ขาด", s: missing.length>0?{fill:RED}:{} }, missing.length],
        [{ v: "   ⚠ เกิน", s: extra.length>0?{fill:ORANGE}:{} }, extra.length],
        ["", ""],
        [{ v: `ความครบถ้วน: ${pct}%`, s: { font: { bold: true, color: { rgb: pct===100?"007A3D":"CC0000" } } } }, ""],
      ]);
      ws1["!cols"] = [{ wch: 36 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws1, "สรุปยอด");
      // Sheet 2: ตรงกัน (with date + staff)
      const ws2 = XLSX.utils.aoa_to_sheet([
        [{v:"เลข Tracking",s:HEADER},{v:"ผู้ยิง",s:HEADER},{v:"เวลายิง",s:HEADER},{v:"สถานะ",s:HEADER}],
        ...matched.map(code => {
          const sc = submitted.find(s=>s.tracking_code===code);
          return [{v:code,s:GREEN},{v:sc?.scanned_by||staffName},{v:sc?.scanned_at?new Date(sc.scanned_at).toLocaleString("th-TH"):dateStr},{v:"✓ ตรงกัน",s:GREEN}];
        })
      ]);
      ws2["!cols"]=[{wch:30},{wch:14},{wch:22},{wch:14}]; XLSX.utils.book_append_sheet(wb,ws2,"ตรงกัน");
      // Sheet 3: ขาด
      const ws3 = XLSX.utils.aoa_to_sheet([
        [{v:"เลข Tracking (ขาด)",s:HEADER},{v:"สถานะ",s:HEADER}],
        ...missing.map(c=>[{v:c,s:RED},{v:"✗ ไม่มาถึงคลัง",s:RED}])
      ]);
      ws3["!cols"]=[{wch:30},{wch:18}]; XLSX.utils.book_append_sheet(wb,ws3,"ขาด");
      // Sheet 4: เกิน
      const ws4 = XLSX.utils.aoa_to_sheet([
        [{v:"เลข Tracking (เกิน)",s:HEADER},{v:"ผู้ยิง",s:HEADER},{v:"สถานะ",s:HEADER}],
        ...extra.map(c=>{const sc=submitted.find(s=>s.tracking_code===c);return [{v:c,s:ORANGE},{v:sc?.scanned_by||staffName},{v:"⚠ ยังไม่อยู่ในระบบ",s:ORANGE}];})
      ]);
      ws4["!cols"]=[{wch:30},{wch:14},{wch:22}]; XLSX.utils.book_append_sheet(wb,ws4,"เกิน");
      XLSX.writeFile(wb, `return_report_${today}.xlsx`);
    } catch (e) { alert("Export ไม่สำเร็จ: " + e.message); }
    setExporting(false);
  };

  if (!staffName) return (
    <div style={{ textAlign: "center", paddingTop: 60 }}>
      <div style={{ fontSize: 36, marginBottom: 16 }}>👤</div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "#1a1040", marginBottom: 8 }}>ระบุชื่อพนักงานก่อน</h2>
      <p style={{ color: "#6b7ab5", fontSize: 14, marginBottom: 24 }}>ใช้บันทึกว่าใครยิงบาร์โค้ด</p>
      <input placeholder="ชื่อพนักงาน" autoFocus
        style={{ background: "rgba(248,250,255,0.86)", border: "1px solid rgba(124,58,237,0.14)", borderRadius: 8, padding: "10px 16px", color: "#1a1040", fontSize: 15, outline: "none", fontFamily: "'Sarabun', sans-serif", width: 240, textAlign: "center" }}
        onKeyDown={e => { if (e.key === "Enter" && e.target.value.trim()) { const n = e.target.value.trim(); setStaffName(n); localStorage.setItem("staffName", n); } }} />
      <div style={{ color: "#9ba3c7", fontSize: 13, marginTop: 10 }}>กด Enter เพื่อยืนยัน</div>
    </div>
  );

  if (loading) return <div style={{ textAlign: "center", paddingTop: 60, color: "#9ba3c7" }}>กำลังโหลดข้อมูลวันนี้...</div>;

  return (
    <div>
      {/* Header row: title + export + refresh + rename */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1a1040", marginBottom: 2 }}>ตีกลับถึงคลัง — ยิงบาร์โค้ด</h2>
          <div style={{ fontSize: 12, color: "#6b7ab5" }}>
            <span style={{ color: "#7c3aed" }}>{staffName}</span> · {new Date().toLocaleDateString("th-TH", { dateStyle: "long" })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button onClick={handleStaffExport} disabled={exporting}
            style={{ background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.3)", color: "#7c3aed", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>
            {exporting ? "⏳..." : "📥 Export Excel"}
          </button>
          <button onClick={loadData} style={{ background: "rgba(255,255,255,0.76)", border: "1px solid rgba(124,58,237,0.16)", color: "#6b7ab5", borderRadius: 8, padding: "7px 14px", fontSize: 13, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>🔄 รีเฟรช</button>
          <button onClick={() => { localStorage.removeItem("staffName"); setStaffName(""); }} style={{ background: "transparent", border: "1px solid rgba(124,58,237,0.14)", color: "#9ba3c7", borderRadius: 8, padding: "7px 14px", fontSize: 13, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>เปลี่ยนชื่อ</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
        {[
          { label: "ระบบแจ้ง", value: systemList.length, color: "#6b7ab5" },
          { label: "ถึงคลังแล้ว", value: submitted.length, color: "#1a1040" },
          { label: "✓ ตรง", value: matched.length, color: "#7c3aed" },
          { label: missing.length > 0 ? "✗ ขาด" : extra.length > 0 ? "⚠ เกิน" : "✓ ครบ!",
            value: missing.length > 0 ? missing.length : extra.length > 0 ? extra.length : "🎉",
            color: missing.length > 0 ? "#ff5555" : extra.length > 0 ? "#ffa500" : "#7c3aed" },
        ].map((s, i) => (
          <div key={i} style={{ background: "rgba(255,255,255,0.86)", border: "1px solid rgba(124,58,237,0.14)", borderRadius: 14, padding: "12px 14px", textAlign: "center" }}>
            <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#9ba3c7", marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Progress */}
      {systemList.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ height: 6, background: "rgba(248,250,255,0.86)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress}%`, background: progress === 100 ? "#7c3aed" : "#ff5555", borderRadius: 3, transition: "width 0.3s" }} />
          </div>
          <div style={{ fontSize: 12, color: "#9ba3c7", marginTop: 3, textAlign: "right" }}>{progress}%</div>
        </div>
      )}

      {/* Start button */}
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <button onClick={() => { setMode("scanning"); setStaging([]); setLastScan(null); }}
          style={{ background: "linear-gradient(135deg,#7c3aed,#3b82f6)", color: "#fff", border: "none", borderRadius: 10, padding: "13px 36px", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>
          📦 เริ่มยิงบาร์โค้ด
        </button>
      </div>

      {/* Submitted list (newest first) */}
      {submitted.length > 0 && (
        <div style={{ background: "rgba(255,255,255,0.86)", border: "1px solid rgba(124,58,237,0.14)", borderRadius: 14, padding: 12, maxHeight: 220, overflowY: "auto" }}>
          <div style={{ fontSize: 11, color: "#6b7ab5", fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
            ยิงและบันทึกแล้ว ({submitted.length})
          </div>
          {submitted.map((s, i) => {
            const ok = systemList.includes(s.tracking_code);
            const timeStr = s.scanned_at ? new Date(s.scanned_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "";
            return (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid #1e2235" }}>
                <span style={{ fontFamily: "monospace", fontSize: 11, color: ok ? "#7c3aed" : "#ffa500" }}>{s.tracking_code}</span>
                <span style={{ fontSize: 11, color: "#9ba3c7" }}>{s.scanned_by} {timeStr}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* SCANNING POPUP */}
      {mode === "scanning" && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(79,70,229,0.2)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "#ffffff", border: "1px solid rgba(124,58,237,0.14)", borderRadius: 18, width: "100%", maxWidth: 520, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>

            {/* Popup header */}
            <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid rgba(124,58,237,0.14)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, color: "#1a1040", fontSize: 17 }}>📦 ยิงบาร์โค้ด</div>
                  <div style={{ fontSize: 12, color: "#6b7ab5", marginTop: 2 }}>
                    รอยืนยัน <span style={{ color: "#7c3aed", fontWeight: 700 }}>{staging.length}</span> รายการ — ยังไม่บันทึก
                  </div>
                </div>
                <div style={{ fontFamily: "monospace", fontSize: 28, fontWeight: 700, color: "#7c3aed" }}>{staging.length}</div>
              </div>

              {/* Scan input - auto focus, auto newline on scan */}
              <input ref={scanRef} value={scanInput} onChange={e => setScanInput(e.target.value)} onKeyDown={handleScan}
                placeholder="ยิงบาร์โค้ดที่นี่... (ขึ้นบรรทัดใหม่ทุกครั้งที่ยิง)"
                style={{ width: "100%", background: "rgba(248,250,255,0.86)", border: `2px solid ${lastScan?.status === "match" ? "#7c3aed" : lastScan?.status === "duplicate" ? "#ffa500" : lastScan?.status === "extra" ? "#ffa500" : "#d4d8f0"}`, borderRadius: 10, padding: "12px 14px", color: "#1a1040", fontSize: 14, outline: "none", fontFamily: "monospace", transition: "border-color 0.2s" }} />

              {/* Last scan feedback */}
              {lastScan && (
                <div style={{ marginTop: 8, padding: "7px 12px", borderRadius: 8, background: lastScan.status === "match" ? "rgba(124,58,237,0.08)" : "rgba(255,165,0,0.08)", border: `1px solid ${lastScan.status === "match" ? "rgba(124,58,237,0.25)" : "rgba(255,165,0,0.25)"}`, display: "flex", alignItems: "center", gap: 10 }}>
                  <span>{lastScan.status === "match" ? "✅" : lastScan.status === "duplicate" ? "⚠️" : "📌"}</span>
                  <div>
                    <span style={{ fontFamily: "monospace", fontSize: 12, color: "#1a1040" }}>{lastScan.code}</span>
                    <span style={{ fontSize: 11, color: lastScan.status === "match" ? "#7c3aed" : "#ffa500", marginLeft: 10 }}>
                      {lastScan.status === "match" ? "✓ อยู่ในรายการ" : lastScan.status === "duplicate" ? "⚠ ยิงซ้ำ" : "📌 บันทึกไว้ก่อน"}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Camera live scanner */}
            <div style={{ padding: "0 20px 10px" }}>
              {!cameraOpen ? (
                <button onClick={openCamera} disabled={cameraLoading}
                  style={{ width: "100%", background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.25)", color: "#7c3aed", borderRadius: 10, padding: "13px", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>
                  {cameraLoading ? "⏳ กำลังเปิดกล้อง..." : "📷 เปิดกล้องสแกน"}
                </button>
              ) : (
                <div>
                  <div id={scannerDivId} style={{ borderRadius: 12, overflow: "hidden", background: "#000", width: "100%" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                    <div style={{ fontSize: 12, color: "#6b7ab5" }}>🟢 กำลังสแกน — ส่องบาร์โค้ดให้อยู่ในกรอบ</div>
                    <button onClick={closeCamera}
                      style={{ background: "rgba(255,85,85,0.1)", border: "1px solid rgba(255,85,85,0.3)", color: "#ff5555", borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>
                      ✕ ปิดกล้อง
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Staged list — newest first, each item on its own row */}
            <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "10px 20px" }}>
              {staging.length === 0 && (
                <div style={{ color: "#c0c4da", fontSize: 13, textAlign: "center", paddingTop: 20 }}>ยังไม่มีรายการ — เริ่มยิงได้เลย</div>
              )}
              {staging.map((entry, i) => {
                const ok = systemList.includes(entry.code);
                return (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #1e2235" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 14 }}>{ok ? "✅" : "📌"}</span>
                      <div>
                        <div style={{ fontFamily: "monospace", fontSize: 13, color: ok ? "#7c3aed" : "#ffa500" }}>{entry.code}</div>
                        <div style={{ fontSize: 10, color: "#9ba3c7", marginTop: 1 }}>{entry.time}</div>
                      </div>
                    </div>
                    <button onClick={() => removeFromStaging(entry.code)}
                      style={{ background: "none", border: "none", color: "#c0c4da", cursor: "pointer", fontSize: 16, padding: "0 4px" }}
                      onMouseEnter={e => e.target.style.color="#ff5555"} onMouseLeave={e => e.target.style.color="#c0c4da"}>✕</button>
                  </div>
                );
              })}
            </div>

            {/* Popup footer */}
            <div style={{ padding: "14px 20px", borderTop: "1px solid rgba(124,58,237,0.14)", display: "flex", gap: 10 }}>
              <button onClick={handleConfirm} disabled={staging.length === 0 || saving}
                style={{ flex: 1, background: staging.length > 0 && !saving ? "#7c3aed" : "rgba(248,250,255,0.86)", color: staging.length > 0 && !saving ? "rgba(248,250,255,0.86)" : "#aab0cc", border: "none", borderRadius: 10, padding: "13px", fontSize: 15, fontWeight: 700, cursor: staging.length > 0 ? "pointer" : "not-allowed", fontFamily: "'Sarabun', sans-serif" }}>
                {saving ? "⏳ กำลังบันทึก..." : `✅ ยืนยัน ${staging.length} รายการ`}
              </button>
              <button onClick={handleCancel}
                style={{ background: "rgba(248,250,255,0.86)", border: "1px solid rgba(124,58,237,0.14)", color: "#6b7ab5", borderRadius: 10, padding: "13px 18px", fontSize: 14, cursor: "pointer", fontFamily: "'Sarabun', sans-serif" }}>
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function ReturnCheckerTab() {
  const [subTab, setSubTab] = useState(() => localStorage.getItem("returnSubTab") || "staff");
  const setAndSave = (v) => { setSubTab(v); localStorage.setItem("returnSubTab", v); };
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
        {[["admin","🗂 ตีกลับในระบบ"],["staff","📦 ตีกลับถึงคลัง"]].map(([v,l]) => (
          <button key={v} onClick={() => setAndSave(v)} className={`tab-btn ${subTab === v ? "active" : ""}`}>{l}</button>
        ))}
      </div>
      {subTab === "admin" ? <ReturnAdminPanel /> : <ReturnStaffPanel />}
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
    <div style={{ fontFamily: "'Sarabun', sans-serif", minHeight: "100vh", background: "rgba(248,250,255,0.86)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');`}</style>
      <div style={{ width: 48, height: 48, border: "3px solid #e0e0f0", borderTop: "3px solid #7c3aed", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <div style={{ color: "#6b7ab5", fontSize: 15 }}>กำลังโหลดข้อมูลจาก Supabase...</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (dbError) return (
    <div style={{ fontFamily: "'Sarabun', sans-serif", minHeight: "100vh", background: "rgba(248,250,255,0.86)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, padding: 32 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');`}</style>
      <div style={{ fontSize: 40 }}>⚠️</div>
      <div style={{ color: "#ff5555", fontWeight: 700, fontSize: 18 }}>เชื่อมต่อฐานข้อมูลไม่สำเร็จ</div>
      <div style={{ color: "#6b7ab5", fontSize: 13, background: "#ffffff", padding: "12px 20px", borderRadius: 8, fontFamily: "monospace", maxWidth: 500, wordBreak: "break-all" }}>{dbError}</div>
      <button onClick={loadAll} style={{ background: "linear-gradient(135deg,#7c3aed,#3b82f6)", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", fontWeight: 700, cursor: "pointer", fontSize: 15, fontFamily: "'Sarabun', sans-serif" }}>ลองใหม่</button>
    </div>
  );

  return (
    <div className="app-shell" style={{ fontFamily: "'Sarabun', sans-serif", minHeight: "100vh", color: "#111827" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #F1F5F9; } ::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 3px; }
        input, select, textarea { font-family: 'Sarabun', sans-serif; }

        :root {
          --ink: #11143d;
          --muted: #68749d;
          --purple: #7c3aed;
          --indigo: #4f46e5;
          --blue: #3b82f6;
          --sky: #60a5fa;
          --paper: rgba(255,255,255,0.88);
          --line: rgba(124,58,237,0.14);
          --shadow: 0 18px 45px rgba(79,70,229,0.13);
        }
        .app-shell {
          background:
            radial-gradient(circle at 8% 0%, rgba(124,58,237,0.24), transparent 32%),
            radial-gradient(circle at 92% 8%, rgba(59,130,246,0.22), transparent 34%),
            linear-gradient(180deg,#fbfbff 0%,#f3f6ff 45%,#eef3ff 100%);
          position: relative;
          overflow-x: hidden;
        }
        .app-shell::before {
          content: "";
          position: fixed;
          inset: 0;
          pointer-events: none;
          background:
            linear-gradient(120deg, rgba(124,58,237,0.08), transparent 34%),
            linear-gradient(300deg, rgba(59,130,246,0.10), transparent 38%);
          mask-image: linear-gradient(#000, transparent 70%);
        }

        .tab-btn { background: transparent; border: 1px solid transparent; cursor: pointer; padding: 9px 16px; border-radius: 12px; font-family: 'Sarabun', sans-serif; font-size: 14px; transition: all 0.2s; color: #6f75a4; white-space: nowrap; }
        .tab-btn.active { background: linear-gradient(135deg,rgba(124,58,237,0.13),rgba(59,130,246,0.12)); color: var(--ink); font-weight: 700; border-color: rgba(124,58,237,0.16); box-shadow: inset 0 1px 0 rgba(255,255,255,0.75); }
        .tab-btn:hover:not(.active) { background: rgba(255,255,255,0.74); color: var(--indigo); border-color: rgba(124,58,237,0.14); }

        .card { background: var(--paper); border: 1px solid rgba(255,255,255,0.72); border-radius: 18px; padding: 24px; box-shadow: var(--shadow); backdrop-filter: blur(16px); }
        .btn { border: none; cursor: pointer; border-radius: 12px; font-family: 'Sarabun', sans-serif; font-weight: 700; transition: all 0.2s; font-size: 14px; }
        .btn-primary { background: linear-gradient(135deg,#7C3AED 0%,#5B6FF4 48%,#38BDF8 100%); color: #fff; padding: 10px 22px; box-shadow: 0 12px 28px rgba(79,70,229,0.24); }
        .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 16px 34px rgba(79,70,229,0.30); }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }
        .btn-danger { background: #FEF2F2; color: #DC2626; padding: 6px 12px; border: 1px solid #FECACA; border-radius: 8px; }
        .btn-danger:hover { background: #FEE2E2; }
        .btn-secondary { background: rgba(255,255,255,0.86); color: var(--purple); padding: 8px 15px; border: 1.5px solid rgba(124,58,237,0.18); border-radius: 11px; box-shadow: 0 6px 18px rgba(79,70,229,0.07); }
        .btn-secondary:hover { background: #fff; border-color: rgba(59,130,246,0.32); color: var(--blue); }

        .inp { background: rgba(255,255,255,0.82); border: 1.5px solid rgba(124,58,237,0.14); border-radius: 12px; padding: 11px 14px; color: var(--ink); width: 100%; font-size: 14px; outline: none; transition: all 0.2s; box-shadow: inset 0 1px 0 rgba(255,255,255,0.7); }
        .inp:focus { border-color: rgba(59,130,246,0.72); background: #fff; box-shadow: 0 0 0 4px rgba(59,130,246,0.10); }

        .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
        .badge-ok { background: #D1FAE5; color: #065F46; }
        .badge-low { background: #FEF3C7; color: #92400E; }
        .badge-out { background: #FEE2E2; color: #991B1B; }

        .overlay { position: fixed; inset: 0; background: rgba(17,24,39,0.42); z-index: 100; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(10px); }
        .modal { background: rgba(255,255,255,0.96); border: 1px solid rgba(255,255,255,0.75); border-radius: 22px; padding: 32px; width: 500px; max-width: 95vw; max-height: 90vh; overflow-y: auto; box-shadow: 0 26px 70px rgba(49,46,129,0.22); }

        .toast { position: fixed; bottom: 28px; right: 28px; z-index: 999; background: rgba(255,255,255,0.96); border: 1px solid rgba(124,58,237,0.16); border-radius: 14px; padding: 14px 22px; font-weight: 700; display: flex; align-items: center; gap: 10px; animation: slideIn 0.3s ease; box-shadow: 0 16px 34px rgba(79,70,229,0.16); color: var(--ink); }
        @keyframes slideIn { from { transform: translateX(60px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

        .stat-card { background: linear-gradient(180deg,rgba(255,255,255,0.94),rgba(255,255,255,0.78)); border: 1px solid rgba(255,255,255,0.82); border-radius: 18px; padding: 20px; box-shadow: var(--shadow); position: relative; overflow: hidden; }
        .stat-card::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 4px; background: linear-gradient(90deg,#7c3aed,#3b82f6,#60a5fa); }
        .mono { font-family: 'Space Mono', monospace; }
        .tx-row { border-left: 4px solid; padding: 12px 16px; border-radius: 12px; background: rgba(255,255,255,0.72); margin-bottom: 8px; box-shadow: inset 0 0 0 1px rgba(124,58,237,0.07); }

        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 13px 16px; font-size: 11px; font-weight: 800; color: var(--purple); text-transform: uppercase; letter-spacing: 1px; border-bottom: 1.5px solid rgba(124,58,237,0.12); background: linear-gradient(90deg,rgba(124,58,237,0.06),rgba(59,130,246,0.05)); }
        td { padding: 14px 16px; border-bottom: 1px solid rgba(124,58,237,0.07); font-size: 14px; vertical-align: middle; color: var(--ink); }
        tr:hover td { background: rgba(239,246,255,0.72); }

        .label { font-size: 12px; color: var(--muted); margin-bottom: 6px; font-weight: 700; }
        .db-dot { width: 7px; height: 7px; background: #10B981; border-radius: 50%; display: inline-block; margin-right: 5px; animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes scanLine { from { transform: translateY(-40px); opacity: 0.6; } to { transform: translateY(40px); opacity: 1; } }

        .section-title { font-size: 24px; font-weight: 800; color: var(--ink); }
        .section-sub { font-size: 14px; color: var(--muted); margin-top: 4px; }
        @media (max-width: 780px) {
          .topbar-inner { height: auto !important; padding: 14px 0; align-items: flex-start !important; }
          .nav-tabs { width: 100%; overflow-x: auto; padding-bottom: 4px; }
        }
      `}</style>

      {/* HEADER — Gradient Nav */}
      <div style={{ background: "rgba(255,255,255,0.78)", padding: "0 32px", boxShadow: "0 12px 34px rgba(79,70,229,0.10)", borderBottom: "1px solid rgba(124,58,237,0.12)", backdropFilter: "blur(18px)", position: "sticky", top: 0, zIndex: 40 }}>
        <div className="topbar-inner" style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 72, gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 42, height: 42, background: "linear-gradient(135deg,#7C3AED,#3B82F6)", color: "#fff", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 21, boxShadow: "0 10px 24px rgba(79,70,229,0.28)" }}>📦</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18, color: "#151341" }}>StockMaster</div>
              <div style={{ fontSize: 11, color: "#6973a4", display: "flex", alignItems: "center", gap: 4 }}>
                <span className="db-dot" style={{ background: "#10B981" }} />เชื่อมต่อ Supabase แล้ว
              </div>
            </div>
          </div>
          <div className="nav-tabs" style={{ display: "flex", gap: 4, background: "rgba(248,250,255,0.72)", padding: 5, borderRadius: 16, border: "1px solid rgba(124,58,237,0.10)" }}>
            {[["dashboard","ภาพรวม"],["inventory","สินค้าคงคลัง"],["transactions","รายการเคลื่อนไหว"],["returns","พัสดุตีกลับ"]].map(([t,label]) => (
              <button key={t} className={`tab-btn ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>{label}</button>
            ))}
          </div>
          <button onClick={loadAll} style={{ background: "#fff", border: "1px solid rgba(124,58,237,0.14)", color: "#4f46e5", padding: "8px 18px", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Sarabun', sans-serif", boxShadow: "0 8px 20px rgba(79,70,229,0.10)" }}>
            🔄 รีเฟรช
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "34px 28px 56px", position: "relative", zIndex: 1 }}>

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
                  {dormantProducts.slice(0, 5).map(p => (
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
                    <div style={{ textAlign: "center", fontSize: 13, color: "#6b7ab5", padding: "6px 0" }}>และอีก {dormantProducts.length - 5} รายการ</div>
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
              </div>
            </div>
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
                      <tr key={p.id} style={{ background: pinnedIds.includes(String(p.id)) ? "rgba(124,58,237,0.04)" : undefined }}>
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
                              ? <img src={p.imageUrl} alt={p.name} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8, border: "1px solid rgba(124,58,237,0.14)" }} />
                              : <div style={{ width: 44, height: 44, borderRadius: 8, border: "2px dashed rgba(124,58,237,0.14)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#c0c4da", background: "#ffffff" }}>📷</div>
                            }
                          </label>
                        </td>
                        <td><span className="mono" style={{ color: "#6b7ab5", fontSize: 12 }}>{p.sku}</span></td>
                        <td style={{ fontWeight: 500, color: "#1a1040" }}>{p.name}</td>

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
        {tab === "transactions" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1a1040" }}>รายการเคลื่อนไหวสินค้า</h1>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => { setTxType("in"); setShowModal("transaction"); }}>▲ รับสินค้า</button>
                <button className="btn btn-secondary" style={{ color: "#ff5555", borderColor: "rgba(255,85,85,0.3)", background: "rgba(255,85,85,0.05)" }} onClick={() => { setTxType("out"); setShowModal("transaction"); }}>▼ เบิกสินค้า</button>
              </div>
            </div>
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <table>
                <thead><tr><th>วันที่</th><th>ประเภท</th><th>สินค้า</th><th>จำนวน</th><th>หมายเหตุ</th><th>ผู้ดำเนินการ</th></tr></thead>
                <tbody>
                  {transactions.map(tx => {
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
              <button className="btn" style={{ background: "rgba(248,250,255,0.86)", color: "#6b7ab5", padding: "10px 20px" }} onClick={() => setShowModal(null)}>ยกเลิก</button>
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
                <button key={t} className="btn" style={{ flex: 1, padding: "10px", background: txType === t ? (t === "in" ? "rgba(124,58,237,0.15)" : "rgba(255,85,85,0.15)") : "rgba(248,250,255,0.86)", color: t === "in" ? "#7c3aed" : "#ff5555", border: `1px solid ${txType === t ? (t === "in" ? "#7c3aed" : "#ff5555") : "#d4d8f0"}`, fontWeight: 700 }} onClick={() => setTxType(t)}>{l}</button>
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
                          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "#ffffff", border: "1px solid rgba(124,58,237,0.14)", borderRadius: 8, maxHeight: 240, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
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
                          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "#ffffff", border: "1px solid rgba(124,58,237,0.14)", borderRadius: 8, padding: "12px 14px", color: "#9ba3c7", fontSize: 13 }}>
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
              <button className="btn" style={{ background: "rgba(248,250,255,0.86)", color: "#6b7ab5", padding: "10px 20px" }} onClick={() => setShowModal(null)}>ยกเลิก</button>
              <button className="btn btn-primary" disabled={saving} style={{ background: txType === "out" ? "#ff5555" : "linear-gradient(135deg,#7c3aed,#3b82f6)", color: "#fff" }} onClick={handleTransaction}>
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
