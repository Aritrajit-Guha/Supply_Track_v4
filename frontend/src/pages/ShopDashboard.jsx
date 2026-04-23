import { useState, useEffect, useCallback } from 'react';
import { useLocation,useNavigate } from 'react-router-dom';
import api from '../services/api';
import socket from '../services/socket';
import AuctionModal from '../components/AuctionModal';
import AIChatWidget from '../components/AIChatWidget';
import { useAuth } from '../context/AuthContext';



const haversine = (lat1, lon1, lat2, lon2) => {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

const CATEGORIES = ['All','Fruits','Vegetables','Dairy','Frozen','Grains','Oils','Poultry'];
const CAT_ICONS  = { Fruits:'🍎', Vegetables:'🥦', Dairy:'🥛', Frozen:'❄️', Grains:'🌾', Oils:'🫙', Poultry:'🥚', All:'🛒' };

const STATUS_COLORS = {
  Confirmed:    { bg:'#dbeafe', color:'#1d4ed8', dot:'#3b82f6' },
  Dispatched:   { bg:'#fef9c3', color:'#854d0e', dot:'#eab308' },
  'In Transit': { bg:'#ede9fe', color:'#5b21b6', dot:'#8b5cf6' },
  Delivered:    { bg:'#dcfce7', color:'#166534', dot:'#22c55e' },
};

export default function ShopDashboard() {
  const { user, logout, refreshProfile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const path = location.pathname;

  //const [view,             setView]             = useState('marketplace');
  const view =
  path === '/cart' ? 'cart' :
  path === '/orders' ? 'orders' :
  path === '/invoice' ? 'invoice' :
  'marketplace';
  const [catalogue,        setCatalogue]        = useState([]);
  const [orders,           setOrders]           = useState([]);
  const [cart,             setCart]             = useState({});
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [search,           setSearch]           = useState('');
  const [selectedOrder,    setSelectedOrder]    = useState(null);
  const [activeAuction,    setActiveAuction]    = useState(null);
  const [loading,          setLoading]          = useState(false);
  const [notes,            setNotes]            = useState('');
  const [creditAnim,       setCreditAnim]       = useState(false);
  const [truckLookup,      setTruckLookup]      = useState({});



  useEffect(() => {
    api.get(`/shop/catalogue`).then(r => setCatalogue(r.data)).catch(console.error);
  }, []);

  const fetchTruckDetails = useCallback(async (truckIds) => {
    if (!truckIds.length) {
      setTruckLookup({});
      return;
    }

    try {
      const responses = await Promise.all(
        truckIds.map((truckId) => api.get(`/truck/status/${truckId}`))
      );
      const nextLookup = responses.reduce((acc, response) => {
        const truck = response.data;
        acc[truck.truck_id] = truck;
        return acc;
      }, {});
      setTruckLookup(nextLookup);
    } catch (error) {
      console.error('Failed to fetch truck details:', error);
    }
  }, []);

  const fetchOrders = useCallback(async() => {
    if(!user) return;
    try{
      const response = await api.get(`/shop/orders`);
      const nextOrders = response.data;
      setOrders(nextOrders);

      const assignedTruckIds = [...new Set(nextOrders.map(order => order.assigned_truck).filter(Boolean))];
      fetchTruckDetails(assignedTruckIds);

      setSelectedOrder((current) => {
        if (!current) {
          return current;
        }
        return nextOrders.find((order) => order.order_id === current.order_id) || current;
      });
    } catch(e){
      console.log(e);
    }
  }, [fetchTruckDetails, user]);

  useEffect(() => { 
    fetchOrders();
   }, [fetchOrders]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      fetchOrders();
    }, 10000);

    return () => clearInterval(intervalId);
  }, [fetchOrders]);

  useEffect(() => {
    const handleEmergency = (data) => {
      console.log("🚨 [SOCKET RECEIVED] Emergency Broadcast:", data);
      console.log("📍 [LOCAL USER DATA]", user);

      // --- HACKATHON DEMO FAILSAFE ---
      // If the user's GPS data is missing from local storage, 
      // we bypass the filter so the demo doesn't fail on stage!
      if (!user || !user.lat || !user.lng) {
        console.warn("⚠️ User has no coordinates in memory! Bypassing distance check for demo.");
        setActiveAuction(data);
        return;
      }

      // Force all coordinates to be Numbers before doing Math
      const dist = haversine(
        Number(user.lat), 
        Number(user.lng), 
        Number(data.truck_lat), 
        Number(data.truck_lng)
      );

      console.log(`📏 Distance to spoiling truck: ${dist.toFixed(2)} km`);

      // If within our massive demo radius, trigger the modal!
      if (dist <= 50) {
        setActiveAuction(data);
      } else {
        console.log("🚚 Truck is out of range. Ignoring.");
      }
    };

    socket.on('emergency_auction_started', handleEmergency);

    return () => {
      socket.off('emergency_auction_started', handleEmergency);
    };
  }, [user]);

  const getQty = (id) => cart[id] || 0;
  const setQty = (id, val) => {
    const n = Math.max(0, Number(val));
    setCart(prev => n === 0 ? (({ [id]: _, ...rest }) => rest)(prev) : { ...prev, [id]: n });
  };
  const cartCount = Object.values(cart).reduce((a,b) => a+b, 0);
  const cartTotal = catalogue.reduce((s,p) => s + (cart[p.product_id]||0)*p.price_per_unit, 0);

  const previewCredits = Math.floor(cartTotal / 500)
    + (catalogue.some(p => (cart[p.product_id]||0) > 0 && p.shelf_life_days <= 10) ? 5 : 0)
    + (catalogue.some(p => (cart[p.product_id]||0) >= 20) ? 3 : 0);

  const filtered = catalogue.filter(p => {
    const catOk  = selectedCategory === 'All' || p.category === selectedCategory;
    const srchOk = p.name.toLowerCase().includes(search.toLowerCase()) ||
                   p.supplier.toLowerCase().includes(search.toLowerCase());
    return catOk && srchOk;
  });

  const placeOrder = async () => {
    if (cartCount === 0) return;
    setLoading(true);
    try {
      const items = Object.entries(cart).map(([product_id, quantity]) => ({ product_id, quantity }));
      const res   = await api.post(`/shop/orders`, { items, notes });
      setCart({});
      setNotes('');
      await fetchOrders();
      await refreshProfile();
      setCreditAnim(true);
      setTimeout(() => setCreditAnim(false), 2000);
      setSelectedOrder(res.data.order);
      navigate('/invoice');
    } catch (e) {
      alert('Failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(()=>{
    if(view==='orders'){
      fetchOrders();
    }
  },[view,fetchOrders]);

  const greenCredits = user?.green_credits || 0;
  const selectedTruck = selectedOrder?.assigned_truck ? truckLookup[selectedOrder.assigned_truck] : null;

  return (
    <div style={{ fontFamily:"'Segoe UI',sans-serif", background:'#f0f4f8', minHeight:'100vh' }}>

      {/* NAV */}
      <nav style={{ background:'linear-gradient(135deg,#0f172a,#1e3a5f)', color:'white', padding:'0 24px', display:'flex', alignItems:'center', justifyContent:'space-between', height:'64px', boxShadow:'0 4px 20px rgba(0,0,0,0.3)', position:'sticky', top:0, zIndex:100 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <span style={{ fontSize:'24px' }}>🌿</span>
          <div>
            <div style={{ fontWeight:800, fontSize:'16px' }}>LiveTrack Supply</div>
            <div style={{ fontSize:'11px', color:'#94a3b8' }}>{user?.shop_name} · {user?.shop_id}</div>
          </div>
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          {/* Green Credits — animates on earn */}
          <div style={{ background:'linear-gradient(135deg,#064e3b,#065f46)', border:'1px solid #059669', borderRadius:'20px', padding:'6px 14px', display:'flex', alignItems:'center', gap:'8px', transition:'transform 0.3s', transform: creditAnim ? 'scale(1.15)' : 'scale(1)' }}>
            <span style={{ fontSize:'16px' }}>🌱</span>
            <div>
              <div style={{ fontSize:'18px', fontWeight:900, color: creditAnim ? '#86efac' : '#4ade80', lineHeight:1 }}>{greenCredits}</div>
              <div style={{ fontSize:'9px', color:'#6ee7b7', textTransform:'uppercase' }}>Green Credits</div>
            </div>
          </div>

          <div style={{ background:'rgba(255,255,255,0.07)', borderRadius:'12px', padding:'6px 12px', fontSize:'12px', color:'#94a3b8', textAlign:'center' }}>
            <div style={{ fontWeight:800, color:'#e2e8f0' }}>{user?.total_orders || 0}</div>
            <div>Orders</div>
          </div>
          <div style={{ background:'rgba(255,255,255,0.07)', borderRadius:'12px', padding:'6px 12px', fontSize:'12px', color:'#94a3b8', textAlign:'center' }}>
            <div style={{ fontWeight:800, color:'#e2e8f0' }}>₹{((user?.total_spent||0)/1000).toFixed(0)}K</div>
            <div>Spent</div>
          </div>

          {[
            { key:'marketplace', icon:'🛒', label:'Shop' },
            { key:'cart',        icon:'🧺', label: cartCount > 0 ? `Cart (${cartCount})` : 'Cart' },
            { key:'orders',      icon:'📋', label:'Orders' },
          ].map(tab => (
            <button key={tab.key} onClick={() => navigate(
  tab.key === 'marketplace' ? '/' :
  `/${tab.key}`
)}
              style={{ background: view===tab.key ? 'rgba(59,130,246,0.25)' : 'transparent', color: view===tab.key ? '#60a5fa' : '#cbd5e1', border: view===tab.key ? '1px solid rgba(59,130,246,0.4)' : '1px solid transparent', borderRadius:'8px', padding:'6px 14px', cursor:'pointer', fontSize:'13px', fontWeight:600 }}>
              {tab.icon} {tab.label}
            </button>
          ))}

          <button onClick={() => navigate('/fleet')}
            style={{ background:'rgba(99,102,241,0.2)', color:'#a5b4fc', border:'1px solid rgba(99,102,241,0.3)', borderRadius:'8px', padding:'6px 14px', cursor:'pointer', fontSize:'13px', fontWeight:600 }}>
            🚛 Fleet
          </button>
          <button onClick={logout}
            style={{ background:'rgba(239,68,68,0.15)', color:'#fca5a5', border:'1px solid rgba(239,68,68,0.3)', borderRadius:'8px', padding:'6px 14px', cursor:'pointer', fontSize:'13px', fontWeight:600 }}>
            Exit
          </button>
        </div>
      </nav>

      {/* ══ MARKETPLACE ══ */}
      {view === 'marketplace' && (
        <div style={{ maxWidth:'1200px', margin:'0 auto', padding:'24px' }}>
          <div style={{ marginBottom:'20px' }}>
            <h2 style={{ margin:'0 0 4px', color:'#0f172a', fontSize:'24px', fontWeight:800 }}>Wholesale Catalogue</h2>
            <p style={{ margin:0, color:'#64748b', fontSize:'14px' }}>Bulk quantities · IoT cold-chain delivery · Earn 🌱 green credits on every order</p>
          </div>

          {/* Green credits banner */}
          <div style={{ background:'linear-gradient(135deg,#064e3b,#065f46)', borderRadius:'12px', padding:'14px 20px', marginBottom:'20px', display:'flex', alignItems:'center', gap:'16px', border:'1px solid #059669' }}>
            <span style={{ fontSize:'28px' }}>🌱</span>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:800, color:'#4ade80', fontSize:'15px' }}>Earn Green Credits on every wholesale order</div>
              <div style={{ color:'#6ee7b7', fontSize:'13px' }}>₹1 credit per ₹500 spent · +5 for perishable items · +3 for 20+ unit bulk orders</div>
            </div>
            <div style={{ background:'rgba(0,0,0,0.3)', borderRadius:'10px', padding:'10px 16px', textAlign:'center' }}>
              <div style={{ fontSize:'22px', fontWeight:900, color:'#4ade80' }}>{greenCredits}</div>
              <div style={{ fontSize:'11px', color:'#6ee7b7' }}>Your credits</div>
            </div>
          </div>

          {/* Search + filter */}
          <div style={{ display:'flex', gap:'12px', marginBottom:'20px', flexWrap:'wrap' }}>
            <input placeholder="🔍  Search products or suppliers…" value={search} onChange={e => setSearch(e.target.value)}
              style={{ flex:1, minWidth:'220px', padding:'10px 16px', border:'2px solid #e2e8f0', borderRadius:'10px', fontSize:'14px', outline:'none', background:'white' }} />
            <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
              {CATEGORIES.map(cat => (
                <button key={cat} onClick={() => setSelectedCategory(cat)}
                  style={{ padding:'8px 14px', border:'2px solid', borderColor: selectedCategory===cat ? '#3b82f6' : '#e2e8f0', borderRadius:'20px', background: selectedCategory===cat ? '#eff6ff' : 'white', color: selectedCategory===cat ? '#1d4ed8' : '#64748b', cursor:'pointer', fontSize:'13px', fontWeight:600 }}>
                  {CAT_ICONS[cat]} {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Product grid */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(240px,1fr))', gap:'16px' }}>
            {filtered.map(p => {
              const qty = getQty(p.product_id);
              return (
                <div key={p.product_id}
                  style={{ background:'white', borderRadius:'14px', overflow:'hidden', boxShadow:'0 2px 8px rgba(0,0,0,0.06)', border:`1.5px solid ${qty>0?'#3b82f6':'#f1f5f9'}`, transition:'all 0.2s' }}
                  onMouseEnter={e => { e.currentTarget.style.transform='translateY(-3px)'; e.currentTarget.style.boxShadow='0 8px 24px rgba(0,0,0,0.1)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'; }}>

                  <div style={{ position:'relative', height:'130px', overflow:'hidden' }}>
                    <img src={p.image} alt={p.name} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                    <div style={{ position:'absolute', top:'8px', left:'8px', background:'rgba(15,23,42,0.75)', color:'white', borderRadius:'6px', padding:'2px 8px', fontSize:'11px', fontWeight:700 }}>
                      {CAT_ICONS[p.category]} {p.category}
                    </div>
                    {p.shelf_life_days <= 10 && (
                      <div style={{ position:'absolute', top:'8px', right:'8px', background:'#fef9c3', color:'#854d0e', borderRadius:'6px', padding:'2px 8px', fontSize:'11px', fontWeight:700 }}>⚡ Quick Shelf</div>
                    )}
                    {qty > 0 && (
                      <div style={{ position:'absolute', bottom:'8px', right:'8px', background:'#3b82f6', color:'white', borderRadius:'20px', padding:'2px 10px', fontSize:'12px', fontWeight:800 }}>{qty} in cart</div>
                    )}
                  </div>

                  <div style={{ padding:'14px' }}>
                    <div style={{ fontWeight:700, fontSize:'15px', color:'#0f172a', marginBottom:'2px' }}>{p.name}</div>
                    <div style={{ fontSize:'12px', color:'#64748b', marginBottom:'6px' }}>{p.supplier}</div>

                    <div style={{ background:'#f0fdf4', borderRadius:'6px', padding:'4px 8px', fontSize:'11px', color:'#166534', fontWeight:600, marginBottom:'8px' }}>
                      📦 {p.wholesale_note || `Min ${p.min_order} ${p.unit}`}
                    </div>

                    <div style={{ display:'flex', gap:'4px', marginBottom:'10px' }}>
                      <span style={{ background:'#eff6ff', color:'#1d4ed8', borderRadius:'6px', padding:'2px 6px', fontSize:'11px', fontWeight:600 }}>{p.shelf_life_days}d shelf</span>
                      <span style={{ background:'#f0fdf4', color:'#166534', borderRadius:'6px', padding:'2px 6px', fontSize:'11px', fontWeight:600 }}>🌡️ {p.storage_temp}</span>
                    </div>

                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                      <div>
                        <div style={{ fontWeight:800, fontSize:'17px', color:'#0f172a' }}>₹{p.price_per_unit}</div>
                        <div style={{ fontSize:'11px', color:'#94a3b8' }}>per {p.unit}</div>
                      </div>
                      <div style={{ display:'flex', alignItems:'center' }}>
                        <button onClick={() => setQty(p.product_id, qty-1)} style={{ width:'30px', height:'30px', border:'2px solid #e2e8f0', borderRadius:'8px 0 0 8px', background: qty>0?'#f1f5f9':'#fafafa', cursor: qty>0?'pointer':'default', fontWeight:800, fontSize:'16px', color:'#64748b' }}>−</button>
                        <div style={{ width:'38px', height:'30px', border:'2px solid #e2e8f0', borderLeft:'none', borderRight:'none', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:'14px', background:'white' }}>{qty}</div>
                        <button onClick={() => setQty(p.product_id, qty+1)} style={{ width:'30px', height:'30px', border:'2px solid #3b82f6', borderRadius:'0 8px 8px 0', background:'#3b82f6', cursor:'pointer', fontWeight:800, fontSize:'16px', color:'white' }}>+</button>
                      </div>
                    </div>
                    {qty > 0 && p.min_order && qty < p.min_order && (
                      <div style={{ marginTop:'6px', fontSize:'11px', color:'#f59e0b', fontWeight:600 }}>⚠️ Min wholesale qty: {p.min_order}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Floating cart CTA */}
          {cartCount > 0 && (
            <div style={{ position:'fixed', bottom:'24px', right:'24px', zIndex:200 }}>
              <button onClick={() => navigate('/cart')}
                style={{ background:'linear-gradient(135deg,#1d4ed8,#3b82f6)', color:'white', border:'none', borderRadius:'16px', padding:'14px 28px', fontSize:'15px', fontWeight:800, cursor:'pointer', boxShadow:'0 8px 32px rgba(59,130,246,0.5)', display:'flex', alignItems:'center', gap:'10px' }}>
                🧺 View Cart — {cartCount} items &nbsp;·&nbsp; ₹{cartTotal.toLocaleString('en-IN')}
                {previewCredits > 0 && <span style={{ background:'rgba(255,255,255,0.2)', borderRadius:'10px', padding:'2px 8px', fontSize:'12px' }}>+{previewCredits} 🌱</span>}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ══ CART ══ */}
      {view === 'cart' && (
        <div style={{ maxWidth:'800px', margin:'0 auto', padding:'24px' }}>
          <h2 style={{ margin:'0 0 20px', fontSize:'24px', fontWeight:800, color:'#0f172a' }}>🧺 Your Cart</h2>
          {cartCount === 0 ? (
            <div style={{ textAlign:'center', padding:'80px 0', color:'#94a3b8' }}>
              <div style={{ fontSize:'64px', marginBottom:'16px' }}>🛒</div>
              <div style={{ fontSize:'20px', fontWeight:700, marginBottom:'16px' }}>Your cart is empty</div>
              <button onClick={() => navigate('/')} style={{ background:'#3b82f6', color:'white', border:'none', borderRadius:'10px', padding:'12px 28px', cursor:'pointer', fontWeight:700 }}>Browse Catalogue</button>
            </div>
          ) : (
            <>
              <div style={{ background:'white', borderRadius:'14px', overflow:'hidden', boxShadow:'0 2px 12px rgba(0,0,0,0.06)', marginBottom:'16px' }}>
                {Object.entries(cart).map(([pid, qty], i, arr) => {
                  const p = catalogue.find(x => x.product_id === pid);
                  if (!p) return null;
                  return (
                    <div key={pid} style={{ display:'flex', alignItems:'center', gap:'16px', padding:'16px 20px', borderBottom: i<arr.length-1 ? '1px solid #f1f5f9' : 'none' }}>
                      <img src={p.image} alt={p.name} style={{ width:'60px', height:'60px', objectFit:'cover', borderRadius:'10px', flexShrink:0 }} />
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:700, color:'#0f172a' }}>{p.name}</div>
                        <div style={{ fontSize:'12px', color:'#64748b' }}>{p.supplier} · {p.unit}</div>
                        <div style={{ fontSize:'12px', color:'#3b82f6', fontWeight:600, marginTop:'2px' }}>₹{p.price_per_unit} × {qty} = ₹{(p.price_per_unit*qty).toLocaleString('en-IN')}</div>
                      </div>
                      <div style={{ display:'flex', alignItems:'center' }}>
                        <button onClick={() => setQty(pid, qty-1)} style={{ width:'32px', height:'32px', border:'2px solid #e2e8f0', borderRadius:'8px 0 0 8px', background:'#f1f5f9', cursor:'pointer', fontWeight:800, color:'#64748b' }}>−</button>
                        <div style={{ width:'40px', height:'32px', border:'2px solid #e2e8f0', borderLeft:'none', borderRight:'none', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, background:'white' }}>{qty}</div>
                        <button onClick={() => setQty(pid, qty+1)} style={{ width:'32px', height:'32px', border:'2px solid #3b82f6', borderRadius:'0 8px 8px 0', background:'#3b82f6', cursor:'pointer', fontWeight:800, color:'white' }}>+</button>
                      </div>
                      <button onClick={() => setQty(pid, 0)} style={{ background:'none', border:'none', cursor:'pointer', color:'#ef4444', fontSize:'18px' }}>✕</button>
                    </div>
                  );
                })}
              </div>

              <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Delivery instructions, special handling…" rows={2}
                style={{ width:'100%', padding:'10px', border:'2px solid #e2e8f0', borderRadius:'10px', resize:'vertical', fontSize:'14px', marginBottom:'12px', boxSizing:'border-box', fontFamily:'inherit', outline:'none' }} />

              {previewCredits > 0 && (
                <div style={{ background:'linear-gradient(135deg,#064e3b,#065f46)', border:'1px solid #059669', borderRadius:'12px', padding:'12px 16px', marginBottom:'12px', display:'flex', alignItems:'center', gap:'12px' }}>
                  <span style={{ fontSize:'24px' }}>🌱</span>
                  <div>
                    <div style={{ fontWeight:800, color:'#4ade80' }}>You'll earn +{previewCredits} Green Credits on this order!</div>
                    <div style={{ fontSize:'12px', color:'#6ee7b7' }}>
                      {Math.floor(cartTotal/500)} base
                      {catalogue.some(p=>(cart[p.product_id]||0)>0&&p.shelf_life_days<=10) ? ' · +5 perishable bonus' : ''}
                      {catalogue.some(p=>(cart[p.product_id]||0)>=20) ? ' · +3 bulk bonus' : ''}
                    </div>
                  </div>
                </div>
              )}

              <div style={{ background:'white', borderRadius:'14px', padding:'20px', boxShadow:'0 2px 8px rgba(0,0,0,0.05)', marginBottom:'16px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'6px', color:'#64748b', fontSize:'14px' }}><span>Subtotal ({cartCount} items)</span><span>₹{cartTotal.toLocaleString('en-IN')}</span></div>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'6px', color:'#64748b', fontSize:'14px' }}><span>IoT Cold-Chain Delivery</span><span style={{ color:'#10b981', fontWeight:700 }}>FREE</span></div>
                <div style={{ display:'flex', justifyContent:'space-between', paddingTop:'12px', borderTop:'2px solid #f1f5f9', fontWeight:800, fontSize:'18px', color:'#0f172a' }}><span>Grand Total</span><span>₹{cartTotal.toLocaleString('en-IN')}</span></div>
              </div>

              <div style={{ display:'flex', gap:'12px' }}>
                <button onClick={() => setView('marketplace')} style={{ flex:1, padding:'14px', background:'white', border:'2px solid #e2e8f0', borderRadius:'10px', cursor:'pointer', fontWeight:700, fontSize:'15px', color:'#475569' }}>← Continue Shopping</button>
                <button onClick={placeOrder} disabled={loading}
                  style={{ flex:2, padding:'14px', background: loading?'#94a3b8':'linear-gradient(135deg,#16a34a,#22c55e)', color:'white', border:'none', borderRadius:'10px', cursor: loading?'default':'pointer', fontWeight:800, fontSize:'16px', boxShadow: loading?'none':'0 4px 16px rgba(34,197,94,0.4)' }}>
                  {loading ? '⏳ Placing Order…' : `✅ Confirm Order — ₹${cartTotal.toLocaleString('en-IN')}`}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ══ ORDERS ══ */}
      {view === 'orders' && !selectedOrder && (
        <div style={{ maxWidth:'900px', margin:'0 auto', padding:'24px' }}>
          <h2 style={{ margin:'0 0 20px', fontSize:'24px', fontWeight:800, color:'#0f172a' }}>📋 My Orders</h2>
          {orders.length === 0 ? (
            <div style={{ textAlign:'center', padding:'80px 0', color:'#94a3b8' }}>
              <div style={{ fontSize:'56px', marginBottom:'12px' }}>📦</div>
              <div style={{ fontSize:'18px', fontWeight:700 }}>No orders yet</div>
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
              {orders.map(order => {
                const sc    = STATUS_COLORS[order.status] || STATUS_COLORS.Confirmed;
                const truck = truckLookup[order.assigned_truck] || {};
                return (
                  <div key={order.order_id}
                    onClick={() => { setSelectedOrder(order); navigate('/orders'); }}
                    style={{ background:'white', borderRadius:'14px', padding:'18px 20px', boxShadow:'0 2px 8px rgba(0,0,0,0.05)', border:'1.5px solid #f1f5f9', cursor:'pointer', transition:'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor='#3b82f6'; e.currentTarget.style.transform='translateX(4px)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor='#f1f5f9'; e.currentTarget.style.transform='none'; }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:800, fontSize:'15px', color:'#0f172a' }}>{order.order_id}</div>
                        <div style={{ fontSize:'12px', color:'#64748b', marginTop:'2px' }}>{order.invoice_number} · {new Date(order.created_at).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'})}</div>
                        <div style={{ fontSize:'13px', color:'#475569', marginTop:'6px' }}>
                          {order.items.slice(0,2).map(i=>i.name).join(', ')}{order.items.length>2?` +${order.items.length-2} more`:''}
                        </div>
                        {order.assigned_truck && (
                          <div style={{ fontSize:'12px', color:'#3b82f6', fontWeight:600, marginTop:'6px' }}>
                            🚛 {order.assigned_truck} · {truck.driver || 'Driver syncing'} · {truck.origin && truck.destination ? `${truck.origin} → ${truck.destination}` : 'Route syncing'}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign:'right', flexShrink:0, marginLeft:'16px' }}>
                        <div style={{ fontWeight:800, fontSize:'17px', color:'#0f172a' }}>₹{order.grand_total.toLocaleString('en-IN')}</div>
                        {order.credits_earned > 0 && <div style={{ fontSize:'12px', color:'#16a34a', fontWeight:700, marginTop:'2px' }}>+{order.credits_earned} 🌱</div>}
                        <div style={{ marginTop:'6px', display:'inline-flex', alignItems:'center', gap:'5px', background:sc.bg, color:sc.color, borderRadius:'20px', padding:'3px 10px', fontSize:'11px', fontWeight:700 }}>
                          <span style={{ width:'6px', height:'6px', borderRadius:'50%', background:sc.dot, display:'inline-block' }}></span>
                          {order.status}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══ INVOICE ══ */}
      {view === 'invoice' && selectedOrder && (
        <div style={{ maxWidth:'800px', margin:'0 auto', padding:'24px' }}>
          <button onClick={() => { setSelectedOrder(null); navigate('/invoice'); }}
            style={{ background:'white', border:'2px solid #e2e8f0', borderRadius:'8px', padding:'8px 16px', cursor:'pointer', fontWeight:700, marginBottom:'20px', color:'#475569' }}>
            ← Back to Orders
          </button>

          <div style={{ background:'white', borderRadius:'16px', overflow:'hidden', boxShadow:'0 4px 24px rgba(0,0,0,0.08)' }}>
            {/* Invoice header */}
            <div style={{ background:'linear-gradient(135deg,#0f172a,#1e3a5f)', color:'white', padding:'28px 32px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'20px' }}>
                <div>
                  <div style={{ fontWeight:900, fontSize:'22px' }}>🌿 LiveTrack Supply</div>
                  <div style={{ color:'#94a3b8', fontSize:'13px' }}>Wholesale Perishables · IoT Supply Chain</div>
                </div>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize:'12px', color:'#94a3b8' }}>INVOICE</div>
                  <div style={{ fontWeight:800, fontSize:'16px' }}>{selectedOrder.invoice_number}</div>
                  <div style={{ fontSize:'12px', color:'#94a3b8' }}>{new Date(selectedOrder.created_at).toLocaleString('en-IN',{dateStyle:'long',timeStyle:'short'})}</div>
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'20px' }}>
                {[
                  { label:'Billed To',       val: selectedOrder.shop_name,       sub: selectedOrder.shop_id },
                  { label:'Order ID',        val: selectedOrder.order_id,        sub: `ETA: ${selectedTruck ? `${selectedTruck.eta_hours}h` : selectedOrder.estimated_delivery}` },
                  { label:'Assigned Truck',  val: selectedOrder.assigned_truck || 'TBD', sub: selectedTruck?.driver || '' },
                  { label:'Payment',         val: '✓ ' + selectedOrder.payment_status, sub: '', green: true },
                ].map(f => (
                  <div key={f.label}>
                    <div style={{ fontSize:'10px', color:'#64748b', fontWeight:700, textTransform:'uppercase', marginBottom:'4px' }}>{f.label}</div>
                    <div style={{ fontWeight:800, color: f.green ? '#4ade80' : 'white' }}>{f.val}</div>
                    <div style={{ fontSize:'12px', color:'#94a3b8' }}>{f.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Truck route bar */}
            {selectedOrder.assigned_truck && selectedTruck && (
              <div style={{ background:'#eff6ff', borderBottom:'2px solid #bfdbfe', padding:'12px 32px', display:'flex', alignItems:'center', gap:'12px' }}>
                <span style={{ fontSize:'20px' }}>🚛</span>
                <div style={{ fontSize:'13px', color:'#1d4ed8' }}>
                  <strong>{selectedOrder.assigned_truck}</strong> · {selectedTruck.driver} · Route: {selectedTruck.origin} → {selectedTruck.destination} · ETA: {selectedTruck.eta_hours}h · Status: {selectedTruck.status}
                </div>
                <button onClick={() => navigate(`/truck/${selectedOrder.assigned_truck}`)}
                  style={{ marginLeft:'auto', background:'#1d4ed8', color:'white', border:'none', borderRadius:'6px', padding:'6px 14px', cursor:'pointer', fontSize:'12px', fontWeight:700 }}>
                  Track Live →
                </button>
              </div>
            )}

            {/* Green credits earned */}
            {selectedOrder.credits_earned > 0 && (
              <div style={{ background:'#f0fdf4', borderBottom:'1px solid #bbf7d0', padding:'12px 32px', display:'flex', alignItems:'center', gap:'10px' }}>
                <span style={{ fontSize:'20px' }}>🌱</span>
                <span style={{ fontSize:'13px', color:'#166534', fontWeight:700 }}>
                  Earned <strong>+{selectedOrder.credits_earned} Green Credits</strong> on this order! Your total: {greenCredits} credits
                </span>
              </div>
            )}

            {/* Delivery stages */}
            {selectedOrder.delivery_stages && (
              <div style={{ padding:'16px 32px', borderBottom:'1px solid #f1f5f9' }}>
                <div style={{ display:'flex', alignItems:'center' }}>
                  {selectedOrder.delivery_stages.map((stage, i) => (
                    <div key={i} style={{ display:'flex', alignItems:'center', flex:1 }}>
                      <div style={{ textAlign:'center', minWidth:'80px' }}>
                        <div style={{ width:'28px', height:'28px', borderRadius:'50%', background: stage.done?'#22c55e':'#e2e8f0', margin:'0 auto 4px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'13px', color: stage.done?'white':'#94a3b8' }}>
                          {stage.done ? '✓' : '○'}
                        </div>
                        <div style={{ fontSize:'10px', color: stage.done?'#166534':'#94a3b8', fontWeight: stage.done?700:400, lineHeight:1.2 }}>{stage.stage}</div>
                      </div>
                      {i < selectedOrder.delivery_stages.length-1 && (
                        <div style={{ flex:1, height:'2px', background: stage.done?'#22c55e':'#e2e8f0', margin:'0 2px 14px' }} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Line items */}
            <div style={{ padding:'0 32px' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'13px' }}>
                <thead>
                  <tr style={{ borderBottom:'2px solid #f1f5f9' }}>
                    {['Item','Supplier','Unit','Temp','Shelf','Qty','Rate','Total'].map(h => (
                      <th key={h} style={{ padding:'12px 6px', textAlign: h==='Item'?'left':'right', color:'#64748b', fontWeight:700, fontSize:'11px', textTransform:'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selectedOrder.items.map((item, i) => (
                    <tr key={i} style={{ borderBottom:'1px solid #f8fafc' }}>
                      <td style={{ padding:'12px 6px', fontWeight:700, color:'#0f172a' }}>{item.name}</td>
                      <td style={{ padding:'12px 6px', color:'#64748b', textAlign:'right', fontSize:'11px' }}>{item.supplier}</td>
                      <td style={{ padding:'12px 6px', color:'#64748b', textAlign:'right', fontSize:'11px' }}>{item.unit}</td>
                      <td style={{ padding:'12px 6px', textAlign:'right' }}><span style={{ background:'#f0fdf4', color:'#166534', borderRadius:'4px', padding:'2px 5px', fontSize:'10px', fontWeight:600 }}>{item.storage_temp}</span></td>
                      <td style={{ padding:'12px 6px', textAlign:'right', fontSize:'11px', color: item.shelf_life_days<=5?'#d97706':'#64748b', fontWeight: item.shelf_life_days<=5?700:400 }}>{item.shelf_life_days}d</td>
                      <td style={{ padding:'12px 6px', textAlign:'right', fontWeight:700 }}>{item.quantity}</td>
                      <td style={{ padding:'12px 6px', textAlign:'right' }}>₹{item.price_per_unit}</td>
                      <td style={{ padding:'12px 6px', textAlign:'right', fontWeight:800, color:'#0f172a' }}>₹{item.line_total.toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Total */}
            <div style={{ padding:'20px 32px 28px', borderTop:'2px solid #f1f5f9', display:'flex', justifyContent:'flex-end' }}>
              <div style={{ textAlign:'right' }}>
                <div style={{ color:'#64748b', fontSize:'14px', marginBottom:'4px' }}>Grand Total</div>
                <div style={{ fontWeight:900, fontSize:'28px', color:'#0f172a' }}>₹{selectedOrder.grand_total.toLocaleString('en-IN')}</div>
                <div style={{ fontSize:'13px', color:'#10b981', fontWeight:700, marginTop:'4px' }}>✓ Paid · IoT Cold-Chain Active</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeAuction && <AuctionModal auctionData={activeAuction} onClose={() => setActiveAuction(null)} />}
      <AIChatWidget page="shop" />
    </div>
  );
}
