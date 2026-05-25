import { useState, useEffect, useCallback } from "react";

const SUPABASE_URL = "https://slwbzbnomsugffyzjyuv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNsd2J6Ym5vbXN1Z2ZmeXpqeXV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgyNDI4MDIsImV4cCI6MjA2MzgxODgwMn0.eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";

const sb = async (path, opts = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: opts.prefer || "return=representation",
      ...opts.headers,
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
  deleteProduct: (id) => sb(`products?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal", headers: { Prefer: "return=minimal" } }),
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

export default function WarehouseApp() {
  const [products, setProducts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ทั้งหมด");
  const [showModal, setShowModal] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [txType, setTxType] = useState("in");
  const [form, setForm] = useState({});
  const [txForm, setTxForm] = useState({ productId: "", quantity: "", note: "", by: "" });
  const [toast, setToast] = useState(null);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
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

  const filteredProducts = (() => {
    let arr = products.filter(p => {
      const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase());
      const matchCat = categoryFilter === "ทั้งหมด" || p.category === categoryFilter;
      return matchSearch && matchCat;
    });
    if (sortCol) {
      arr = [...arr].sort((a, b) => {
        let av = a[sortCol], bv = b[sortCol];
        const r = typeof av === "string" ? av.localeCompare(bv, "th") : av - bv;
        return sortDir === "asc" ? r : -r;
      });
    }
    return arr;
  })();

  const lowStock = products.filter(p => p.minStock > 0 && p.quantity <= p.minStock);
  const totalValue = products.reduce((s, p) => s + Math.max(0, p.quantity) * p.price, 0);
  const totalItems = products.reduce((s, p) => s + p.quantity, 0);

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
    if (txType === "out" && product.quantity < qty) return showToast("สินค้าในคลังไม่เพียงพอ", "error");
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
    <div style={{ fontFamily: "'Sarabun', sans-serif", minHeight: "100vh", background: "#0f1117", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');`}</style>
      <div style={{ width: 48, height: 48, border: "3px solid #2a2f45", borderTop: "3px solid #64ffda", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <div style={{ color: "#8892b0", fontSize: 15 }}>กำลังโหลดข้อมูลจาก Supabase...</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (dbError) return (
    <div style={{ fontFamily: "'Sarabun', sans-serif", minHeight: "100vh", background: "#0f1117", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, padding: 32 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');`}</style>
      <div style={{ fontSize: 40 }}>⚠️</div>
      <div style={{ color: "#ff5555", fontWeight: 700, fontSize: 18 }}>เชื่อมต่อฐานข้อมูลไม่สำเร็จ</div>
      <div style={{ color: "#8892b0", fontSize: 13, background: "#1a1d27", padding: "12px 20px", borderRadius: 8, fontFamily: "monospace", maxWidth: 500, wordBreak: "break-all" }}>{dbError}</div>
      <button onClick={loadAll} style={{ background: "#64ffda", color: "#0f1117", border: "none", borderRadius: 8, padding: "10px 24px", fontWeight: 700, cursor: "pointer", fontSize: 15, fontFamily: "'Sarabun', sans-serif" }}>ลองใหม่</button>
    </div>
  );

  return (
    <div style={{ fontFamily: "'Sarabun', sans-serif", minHeight: "100vh", background: "#0f1117", color: "#e8eaf0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #1a1d27; } ::-webkit-scrollbar-thumb { background: #3a3f5c; border-radius: 3px; }
        input, select, textarea { font-family: 'Sarabun', sans-serif; }
        .tab-btn { background: none; border: none; cursor: pointer; padding: 10px 20px; border-radius: 8px; font-family: 'Sarabun', sans-serif; font-size: 15px; transition: all 0.2s; color: #8892b0; }
        .tab-btn.active { background: #1e2235; color: #64ffda; font-weight: 600; }
        .tab-btn:hover:not(.active) { background: #161924; color: #ccd6f6; }
        .card { background: #1a1d27; border: 1px solid #2a2f45; border-radius: 14px; padding: 20px; }
        .btn { border: none; cursor: pointer; border-radius: 8px; font-family: 'Sarabun', sans-serif; font-weight: 600; transition: all 0.2s; font-size: 14px; }
        .btn-primary { background: #64ffda; color: #0f1117; padding: 10px 20px; }
        .btn-primary:hover { background: #4de8c4; transform: translateY(-1px); }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .btn-danger { background: rgba(255,85,85,0.1); color: #ff5555; padding: 6px 12px; border: 1px solid rgba(255,85,85,0.3); }
        .btn-danger:hover { background: rgba(255,85,85,0.2); }
        .btn-secondary { background: rgba(100,255,218,0.08); color: #64ffda; padding: 6px 12px; border: 1px solid rgba(100,255,218,0.2); }
        .btn-secondary:hover { background: rgba(100,255,218,0.15); }
        .inp { background: #0f1117; border: 1px solid #2a2f45; border-radius: 8px; padding: 10px 14px; color: #e8eaf0; width: 100%; font-size: 14px; outline: none; transition: border 0.2s; }
        .inp:focus { border-color: #64ffda; }
        .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
        .badge-ok { background: rgba(100,255,218,0.1); color: #64ffda; }
        .badge-low { background: rgba(255,165,0,0.1); color: #ffa500; }
        .badge-out { background: rgba(255,85,85,0.1); color: #ff5555; }
        .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 100; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
        .modal { background: #1a1d27; border: 1px solid #2a2f45; border-radius: 18px; padding: 28px; width: 480px; max-width: 95vw; max-height: 90vh; overflow-y: auto; }
        .toast { position: fixed; bottom: 28px; right: 28px; z-index: 999; background: #1a1d27; border: 1px solid #2a2f45; border-radius: 12px; padding: 14px 22px; font-weight: 600; display: flex; align-items: center; gap: 10px; animation: slideIn 0.3s ease; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
        @keyframes slideIn { from { transform: translateX(60px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .stat-card { background: linear-gradient(135deg, #1a1d27 0%, #1e2235 100%); border: 1px solid #2a2f45; border-radius: 14px; padding: 22px; position: relative; overflow: hidden; }
        .mono { font-family: 'Space Mono', monospace; }
        .tx-row { border-left: 3px solid; padding: 12px 16px; border-radius: 0 8px 8px 0; background: rgba(255,255,255,0.02); margin-bottom: 8px; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 12px 16px; font-size: 12px; font-weight: 600; color: #64ffda; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #2a2f45; }
        td { padding: 13px 16px; border-bottom: 1px solid #1e2235; font-size: 14px; vertical-align: middle; }
        tr:hover td { background: rgba(255,255,255,0.02); }
        .label { font-size: 12px; color: #8892b0; margin-bottom: 6px; font-weight: 500; }
        .db-dot { width: 8px; height: 8px; background: #64ffda; border-radius: 50%; display: inline-block; margin-right: 6px; animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>

      {/* HEADER */}
      <div style={{ background: "#12151f", borderBottom: "1px solid #2a2f45", padding: "0 28px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, background: "linear-gradient(135deg, #64ffda, #0a8f6e)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📦</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 17, color: "#ccd6f6" }}>StockMaster</div>
              <div style={{ fontSize: 11, color: "#8892b0" }}><span className="db-dot" />เชื่อมต่อ Supabase แล้ว</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {[["dashboard","📊","ภาพรวม"],["inventory","📦","สินค้าคงคลัง"],["transactions","🔄","รายการเคลื่อนไหว"]].map(([t,icon,label]) => (
              <button key={t} className={`tab-btn ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>{icon} {label}</button>
            ))}
          </div>
          <button onClick={loadAll} className="btn btn-secondary" style={{ fontSize: 13 }}>🔄 รีเฟรช</button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px" }}>

        {/* DASHBOARD */}
        {tab === "dashboard" && (
          <div>
            <div style={{ marginBottom: 28 }}>
              <h1 style={{ fontSize: 26, fontWeight: 700, color: "#ccd6f6" }}>ภาพรวมคลังสินค้า</h1>
              <p style={{ color: "#8892b0", marginTop: 4 }}>อัปเดตล่าสุด: {new Date().toLocaleDateString("th-TH", { dateStyle: "long" })}</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16, marginBottom: 28 }}>
              {[
                { label: "มูลค่าสินค้าทั้งหมด", value: `฿${totalValue.toLocaleString("th-TH")}`, icon: "💰", color: "#64ffda" },
                { label: "รายการสินค้า", value: `${products.length} รายการ`, icon: "🗂️", color: "#82aaff" },
                { label: "จำนวนชิ้นทั้งหมด", value: totalItems.toLocaleString("th-TH"), icon: "📦", color: "#c3e88d" },
                { label: "สินค้าใกล้หมด", value: `${lowStock.length} รายการ`, icon: "⚠️", color: "#ffa500" },
              ].map((s, i) => (
                <div key={i} className="stat-card">
                  <div style={{ fontSize: 28, marginBottom: 12 }}>{s.icon}</div>
                  <div className="mono" style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ color: "#8892b0", marginTop: 4, fontSize: 14 }}>{s.label}</div>
                </div>
              ))}
            </div>
            {lowStock.length > 0 && (
              <div className="card" style={{ marginBottom: 24, border: "1px solid rgba(255,165,0,0.3)" }}>
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
                          <div style={{ fontWeight: 600, color: "#ccd6f6" }}>{p.name}</div>
                          <div style={{ fontSize: 12, color: "#8892b0" }}>{p.sku}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div className={`badge ${p.quantity <= 0 ? "badge-out" : "badge-low"}`}>{p.quantity <= 0 ? "หมดสต็อก" : `เหลือ ${p.quantity} ${p.unit}`}</div>
                        <div style={{ fontSize: 12, color: "#8892b0", marginTop: 4 }}>ขั้นต่ำ: {p.minStock} {p.unit}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="card">
              <h2 style={{ fontSize: 17, fontWeight: 700, color: "#ccd6f6", marginBottom: 16 }}>รายการล่าสุด</h2>
              {transactions.length === 0 && <div style={{ color: "#8892b0", textAlign: "center", padding: 24 }}>ยังไม่มีรายการเคลื่อนไหว</div>}
              {transactions.slice(0, 5).map(tx => {
                const p = products.find(x => x.id === tx.productId);
                return (
                  <div key={tx.id} className="tx-row" style={{ borderColor: tx.type === "in" ? "#64ffda" : "#ff5555" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <span style={{ fontWeight: 600, color: tx.type === "in" ? "#64ffda" : "#ff5555", marginRight: 8 }}>{tx.type === "in" ? "▲ รับเข้า" : "▼ เบิกออก"}</span>
                        <span style={{ color: "#ccd6f6" }}>{p?.name}</span>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div className="mono" style={{ color: tx.type === "in" ? "#64ffda" : "#ff5555", fontWeight: 700 }}>{tx.type === "in" ? "+" : "-"}{tx.quantity} {p?.unit}</div>
                        <div style={{ fontSize: 12, color: "#8892b0" }}>{tx.date} · {tx.by}</div>
                      </div>
                    </div>
                    {tx.note && <div style={{ fontSize: 13, color: "#8892b0", marginTop: 4 }}>📝 {tx.note}</div>}
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
              <h1 style={{ fontSize: 24, fontWeight: 700, color: "#ccd6f6" }}>สินค้าคงคลัง <span style={{ fontSize: 14, color: "#8892b0", fontWeight: 400 }}>({filteredProducts.length} รายการ)</span></h1>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => { setTxType("in"); setShowModal("transaction"); }}>▲ รับสินค้า</button>
                <button className="btn btn-secondary" style={{ color: "#ff5555", borderColor: "rgba(255,85,85,0.3)", background: "rgba(255,85,85,0.05)" }} onClick={() => { setTxType("out"); setShowModal("transaction"); }}>▼ เบิกสินค้า</button>
                <button className="btn btn-primary" onClick={() => { setForm({}); setShowModal("add-product"); }}>+ เพิ่มสินค้า</button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              <input className="inp" style={{ flex: 1, minWidth: 200 }} placeholder="🔍 ค้นหาชื่อหรือ SKU..." value={search} onChange={e => setSearch(e.target.value)} />
              <select className="inp" style={{ width: "auto" }} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>รูป</th>
                    <SortTh col="sku" label="SKU" />
                    <SortTh col="name" label="ชื่อสินค้า" />
                    <SortTh col="category" label="หมวดหมู่" />
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
                      <tr key={p.id}>
                        <td>
                          <label style={{ cursor: "pointer", display: "block" }}>
                            <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => e.target.files[0] && handleImageUpload(p, e.target.files[0])} />
                            {p.imageUrl
                              ? <img src={p.imageUrl} alt={p.name} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8, border: "1px solid #2a2f45" }} />
                              : <div style={{ width: 44, height: 44, borderRadius: 8, border: "2px dashed #2a2f45", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#3a3f5c", background: "#12151f" }}>📷</div>
                            }
                          </label>
                        </td>
                        <td><span className="mono" style={{ color: "#8892b0", fontSize: 12 }}>{p.sku}</span></td>
                        <td style={{ fontWeight: 500, color: "#ccd6f6" }}>{p.name}</td>
                        <td><span style={{ background: "#1e2235", borderRadius: 6, padding: "3px 8px", fontSize: 12 }}>{p.category}</span></td>
                        <td className="mono" style={{ fontWeight: 700, color: p.quantity < 0 ? "#ff5555" : undefined }}>{p.quantity} <span style={{ color: "#8892b0", fontSize: 12, fontWeight: 400 }}>{p.unit}</span></td>
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
              {filteredProducts.length === 0 && <div style={{ textAlign: "center", padding: 48, color: "#8892b0" }}>ไม่พบสินค้าที่ค้นหา</div>}
            </div>
          </div>
        )}

        {/* TRANSACTIONS */}
        {tab === "transactions" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: "#ccd6f6" }}>รายการเคลื่อนไหวสินค้า</h1>
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
                        <td className="mono" style={{ color: "#8892b0", fontSize: 13 }}>{tx.date}</td>
                        <td><span className={`badge ${tx.type === "in" ? "badge-ok" : "badge-out"}`}>{tx.type === "in" ? "▲ รับเข้า" : "▼ เบิกออก"}</span></td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {p?.imageUrl && <img src={p.imageUrl} style={{ width: 28, height: 28, borderRadius: 4, objectFit: "cover" }} />}
                            <div>
                              <div style={{ fontWeight: 500, color: "#ccd6f6" }}>{p?.name || "ไม่ทราบ"}</div>
                              <div style={{ fontSize: 12, color: "#8892b0" }}>{p?.sku}</div>
                            </div>
                          </div>
                        </td>
                        <td className="mono" style={{ fontWeight: 700, color: tx.type === "in" ? "#64ffda" : "#ff5555" }}>{tx.type === "in" ? "+" : "-"}{tx.quantity} {p?.unit}</td>
                        <td style={{ color: "#8892b0", fontSize: 14 }}>{tx.note || "-"}</td>
                        <td style={{ color: "#ccd6f6" }}>{tx.by}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {transactions.length === 0 && <div style={{ textAlign: "center", padding: 48, color: "#8892b0" }}>ยังไม่มีรายการเคลื่อนไหว</div>}
            </div>
          </div>
        )}
      </div>

      {/* MODALS */}
      {(showModal === "add-product" || showModal === "edit") && (
        <div className="overlay" onClick={() => setShowModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#ccd6f6", marginBottom: 20 }}>
              {showModal === "edit" ? "✏️ แก้ไขสินค้า" : "📦 เพิ่มสินค้าใหม่"}
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <div className="label">SKU / รหัสสินค้า</div>
                <input className="inp" value={form.sku || ""} onChange={e => setForm({ ...form, sku: e.target.value })} />
              </div>
              <div>
                <div className="label">หมวดหมู่</div>
                <select className="inp" value={form.category || ""} onChange={e => setForm({ ...form, category: e.target.value })}>
                  <option value="">เลือกหมวดหมู่</option>
                  {["กำลังขาย", "-"].map(c => <option key={c}>{c}</option>)}
                </select>
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
              <button className="btn" style={{ background: "#1e2235", color: "#8892b0", padding: "10px 20px" }} onClick={() => setShowModal(null)}>ยกเลิก</button>
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
                <button key={t} className="btn" style={{ flex: 1, padding: "10px", background: txType === t ? (t === "in" ? "rgba(100,255,218,0.15)" : "rgba(255,85,85,0.15)") : "#0f1117", color: t === "in" ? "#64ffda" : "#ff5555", border: `1px solid ${txType === t ? (t === "in" ? "#64ffda" : "#ff5555") : "#2a2f45"}`, fontWeight: 700 }} onClick={() => setTxType(t)}>{l}</button>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <div className="label">สินค้า</div>
                <select className="inp" value={txForm.productId} onChange={e => setTxForm({ ...txForm, productId: e.target.value })}>
                  <option value="">-- เลือกสินค้า --</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} (คงเหลือ: {p.quantity} {p.unit})</option>)}
                </select>
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
              <button className="btn" style={{ background: "#1e2235", color: "#8892b0", padding: "10px 20px" }} onClick={() => setShowModal(null)}>ยกเลิก</button>
              <button className="btn btn-primary" disabled={saving} style={{ background: txType === "out" ? "#ff5555" : "#64ffda", color: "#0f1117" }} onClick={handleTransaction}>
                {saving ? "กำลังบันทึก..." : txType === "in" ? "รับสินค้าเข้า" : "เบิกสินค้าออก"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" style={{ borderColor: toast.type === "error" ? "rgba(255,85,85,0.4)" : "rgba(100,255,218,0.3)", color: toast.type === "error" ? "#ff5555" : "#64ffda" }}>
          <span>{toast.type === "error" ? "❌" : "✅"}</span>
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}
