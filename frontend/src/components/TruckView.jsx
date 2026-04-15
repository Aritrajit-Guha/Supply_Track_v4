import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import './TruckView.css';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

const API = `${BACKEND_URL}/api`;

const TruckView = () => {
  const [hoveredBatch, setHoveredBatch] = useState(null);
  const [truckData,    setTruckData]    = useState(null);
  const [cargoBatches, setCargoBatches] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');

  const { id } = useParams();
  const navigate = useNavigate();
  const authHeaders = { Authorization: `Bearer ${localStorage.getItem('token')}` };

  useEffect(() => {
    setLoading(true);
    api.get(`/truck/cargo/${id}`)
      .then(r => {
        setTruckData(r.data.truck);
        setCargoBatches(r.data.cargo);
        setLoading(false);
      })
      .catch(err => {
        setError('Could not load cargo data. Is Flask running?');
        setLoading(false);
        console.error(err);
      });
  }, [id]);

  const handleTriggerAuction = async (batch) => {
    try {
      await api.post(`/auction/trigger`, {
        auction_id: `A-${batch.id}`,
        truck_id:   id,
        batch_item: `${batch.quantity} × ${batch.name} (${batch.unit}) — Temp: ${batch.temp}°C`,
        base_price: 500,
        truck_lat:  truckData?.lat  || 23.5742,
        truck_lng:  truckData?.lng  || 87.3203,
      }, { headers: authHeaders });
      alert(`✅ Flash Auction triggered for ${batch.name}! All nearby shops notified.`);
    } catch (err) {
      console.error(err);
      alert('❌ Failed to trigger auction.');
    }
  };

  // Loading screen
  if (loading) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'#f1f5f9', fontFamily:'sans-serif' }}>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:'48px', marginBottom:'16px' }}>🚛</div>
          <div style={{ fontSize:'18px', color:'#64748b', fontWeight:700 }}>Loading IoT cargo data…</div>
        </div>
      </div>
    );
  }

  // Error screen
  if (error) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'#f1f5f9', fontFamily:'sans-serif' }}>
        <div style={{ textAlign:'center', maxWidth:'400px' }}>
          <div style={{ fontSize:'48px', marginBottom:'16px' }}>❌</div>
          <div style={{ fontSize:'18px', color:'#ef4444', fontWeight:700, marginBottom:'16px' }}>{error}</div>
          <button onClick={() => navigate('/fleet')} style={{ background:'#3b82f6', color:'white', border:'none', borderRadius:'8px', padding:'12px 24px', cursor:'pointer', fontWeight:700 }}>
            ← Back to Fleet
          </button>
        </div>
      </div>
    );
  }

  // Empty cargo screen
  if (cargoBatches.length === 0) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'#f1f5f9', fontFamily:'sans-serif', padding:'20px' }}>
        <div style={{ textAlign:'center', maxWidth:'400px' }}>
          <div style={{ fontSize:'56px', marginBottom:'16px' }}>📦</div>
          <div style={{ fontSize:'22px', fontWeight:800, color:'#0f172a', marginBottom:'8px' }}>No cargo for your shop on {id}</div>
          <div style={{ fontSize:'14px', color:'#64748b', marginBottom:'24px' }}>
            This truck hasn't been assigned any of your orders yet. Place an order first and it will appear here.
          </div>
          <div style={{ display:'flex', gap:'12px', justifyContent:'center' }}>
            <button onClick={() => navigate('/')} style={{ background:'#3b82f6', color:'white', border:'none', borderRadius:'8px', padding:'12px 24px', cursor:'pointer', fontWeight:700 }}>
              🛒 Place an Order
            </button>
            <button onClick={() => navigate('/fleet')} style={{ background:'white', color:'#475569', border:'2px solid #e2e8f0', borderRadius:'8px', padding:'12px 24px', cursor:'pointer', fontWeight:700 }}>
              ← Fleet
            </button>
          </div>
        </div>
      </div>
    );
  }

  const truck = truckData || {};

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', fontFamily:'sans-serif', padding:'20px', backgroundColor:'#f1f5f9', minHeight:'100vh' }}>

      {/* Back Button */}
      <div style={{ width:'100%', maxWidth:'900px', marginBottom:'20px' }}>
        <button onClick={() => navigate('/fleet')}
          style={{ padding:'10px 20px', backgroundColor:'#334155', border:'none', borderRadius:'6px', cursor:'pointer', fontWeight:'bold', color:'white', display:'flex', alignItems:'center', gap:'8px' }}>
          ⬅ Back to Fleet Dashboard
        </button>
      </div>

      {/* Truck Info Header */}
      <div style={{ backgroundColor:'#0f172a', color:'white', padding:'20px 40px', borderRadius:'12px', marginBottom:'30px', textAlign:'center', width:'100%', maxWidth:'800px', boxShadow:'0 10px 25px rgba(0,0,0,0.2)' }}>
        <h1 style={{ margin:'0 0 8px 0', display:'flex', alignItems:'center', justifyContent:'center', gap:'10px' }}>
          <span style={{ color:'#3b82f6' }}>LIVE TRACKING:</span> {id}
        </h1>
        <div style={{ fontSize:'14px', color:'#64748b', marginBottom:'12px' }}>
          👤 Driver: <strong style={{ color:'#94a3b8' }}>{truck.driver}</strong>
          &nbsp;·&nbsp;
          📦 {cargoBatches.length} batch{cargoBatches.length !== 1 ? 'es' : ''} for your shop
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:'15px', color:'#cbd5e1', fontWeight:'bold', flexWrap:'wrap', gap:'8px' }}>
          <span>📍 {truck.destination || 'En Route'}</span>
          <span>🛣️ {truck.distance_left_km} km remaining</span>
          <span>⏱️ ETA: {truck.eta_hours}h</span>
          <span>🌡️ Cabin: {truck.current_temperature}°C</span>
        </div>
      </div>

      <div style={{ display:'flex', gap:'40px', alignItems:'flex-start', flexWrap:'wrap', justifyContent:'center' }}>

        {/* Animated Truck with real cargo */}
        <div className="animated-road" style={{ width:'360px', height:'700px', padding:'20px', borderRadius:'16px', display:'flex', justifyContent:'center', overflow:'hidden', boxShadow:'inset 0 0 50px rgba(0,0,0,0.5)' }}>
          <div className="truck-wrapper">
            <div className="wheel w-cab-l"></div>
            <div className="wheel w-cab-r"></div>
            <div className="truck-cab"><div className="windshield"></div></div>
            <div className="trailer-joint"></div>
            <div className="truck-trailer">
              <div className="wheel w-mid-l"></div>
              <div className="wheel w-mid-r"></div>
              <div className="wheel w-mid-l2"></div>
              <div className="wheel w-mid-r2"></div>
              <div className="wheel w-back-l"></div>
              <div className="wheel w-back-r"></div>
              <div className="wheel w-back-l2"></div>
              <div className="wheel w-back-r2"></div>

              {/* Real cargo from shop's orders */}
              <div className="cargo-grid" style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:'6px', overflowY:'auto', flex:1, padding:'4px' }}>
                {cargoBatches.map((batch) => (
                  <div
                    key={batch.id}
                    onMouseEnter={() => setHoveredBatch(batch)}
                    onMouseLeave={() => setHoveredBatch(null)}
                    style={{
                      gridRow:  `span ${batch.spanRow}`,
                      gridColumn: `span ${batch.spanCol}`,
                      backgroundImage: `linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.7)), url(${batch.image})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      border: batch.isSpoiling ? '3px solid #ef4444' : '2px solid #94a3b8',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      minHeight: '75px',
                      position: 'relative',
                      boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
                    }}
                  >
                    {batch.isSpoiling && (
                      <div style={{ position:'absolute', top:-5, right:-5, backgroundColor:'#ef4444', color:'white', padding:'4px 6px', fontSize:'10px', fontWeight:'900', borderRadius:'4px', border:'2px solid white', zIndex:5, animation:'pulse 1.5s infinite' }}>⚠️ ALERT</div>
                    )}
                    <div style={{ position:'absolute', bottom:'5px', left:'5px', color:'white', fontSize:'10px', fontWeight:'bold', backgroundColor:'rgba(0,0,0,0.7)', padding:'2px 5px', borderRadius:'4px', lineHeight:1.3 }}>
                      <div>{batch.product_id}</div>
                      <div style={{ color:'#94a3b8' }}>×{batch.quantity}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Hover Info Panel */}
        <div style={{ width:'380px', backgroundColor:'white', border:'1px solid #cbd5e1', borderRadius:'12px', padding:'25px', boxShadow:'0 20px 25px -5px rgba(0,0,0,0.1)' }}>
          <h3 style={{ marginTop:0, borderBottom:'3px solid #f1f5f9', paddingBottom:'15px', color:'#1e293b', fontSize:'20px' }}>
            📦 IoT Batch Diagnostics
          </h3>

          {hoveredBatch ? (
            <div>
              {/* Product image */}
              <div style={{ height:'120px', width:'100%', backgroundImage:`url(${hoveredBatch.image})`, backgroundSize:'cover', backgroundPosition:'center', borderRadius:'8px', marginBottom:'15px' }} />

              <h2 style={{ color: hoveredBatch.isSpoiling ? '#ef4444' : '#0f172a', margin:'0 0 4px', fontSize:'20px' }}>{hoveredBatch.name}</h2>
              <div style={{ fontSize:'13px', color:'#64748b', marginBottom:'4px' }}>Supplier: {hoveredBatch.supplier}</div>
              <div style={{ fontSize:'13px', color:'#64748b', marginBottom:'12px' }}>Order: {hoveredBatch.order_id}</div>

              {/* Quantity ordered */}
              <div style={{ background:'#eff6ff', borderRadius:'8px', padding:'10px 14px', marginBottom:'12px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ color:'#1d4ed8', fontWeight:700 }}>📦 Your Order Qty</span>
                <span style={{ fontWeight:900, fontSize:'18px', color:'#0f172a' }}>{hoveredBatch.quantity} × {hoveredBatch.unit}</span>
              </div>

              {/* Temperature */}
              <div style={{ display:'flex', alignItems:'center', backgroundColor:'#f8fafc', padding:'15px', borderRadius:'8px', marginBottom:'12px' }}>
                <span style={{ fontSize:'32px', marginRight:'15px' }}>🌡️</span>
                <div>
                  <div style={{ fontSize:'13px', color:'#64748b', fontWeight:'bold', textTransform:'uppercase' }}>Sensor Temp</div>
                  <div style={{ fontSize:'28px', fontWeight:'900', color: hoveredBatch.isSpoiling ? '#ef4444' : '#10b981' }}>
                    {hoveredBatch.temp}°C
                  </div>
                  <div style={{ fontSize:'12px', color:'#94a3b8' }}>Safe: {hoveredBatch.storage_temp}</div>
                </div>
              </div>

              <div style={{ display:'flex', justifyContent:'space-between', borderBottom:'1px solid #e2e8f0', paddingBottom:'10px', marginBottom:'10px' }}>
                <span style={{ color:'#64748b' }}>Health Status:</span>
                <span style={{ color: hoveredBatch.isSpoiling ? '#ef4444' : '#10b981', fontWeight:'bold' }}>{hoveredBatch.health}</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'20px' }}>
                <span style={{ color:'#64748b' }}>Shelf Life:</span>
                <span style={{ fontWeight:'bold', color:'#0f172a' }}>{hoveredBatch.expiry}</span>
              </div>

              {hoveredBatch.isSpoiling && (
                <button
                  onClick={() => handleTriggerAuction(hoveredBatch)}
                  style={{ backgroundColor:'#ef4444', color:'white', border:'none', padding:'15px', width:'100%', borderRadius:'8px', fontSize:'16px', fontWeight:'900', cursor:'pointer', boxShadow:'0 4px 6px rgba(239,68,68,0.3)' }}>
                  ⚡ TRIGGER FLASH AUCTION
                </button>
              )}
            </div>
          ) : (
            <div style={{ color:'#94a3b8', textAlign:'center', marginTop:'40px', padding:'20px' }}>
              <span style={{ fontSize:'50px', display:'block', marginBottom:'15px' }}>🖱️</span>
              <p style={{ fontSize:'16px', lineHeight:'1.5' }}>
                Hover over the cargo grid to see IoT sensor data for each batch.
              </p>
              <div style={{ marginTop:'20px', background:'#f8fafc', borderRadius:'10px', padding:'14px', textAlign:'left' }}>
                <div style={{ fontSize:'12px', color:'#64748b', fontWeight:700, textTransform:'uppercase', marginBottom:'8px' }}>Your cargo on this truck</div>
                {cargoBatches.map(b => (
                  <div key={b.id} style={{ display:'flex', justifyContent:'space-between', fontSize:'13px', padding:'4px 0', borderBottom:'1px solid #f1f5f9', color: b.isSpoiling ? '#ef4444' : '#475569' }}>
                    <span>{b.isSpoiling ? '⚠️ ' : '✅ '}{b.name}</span>
                    <span style={{ fontWeight:700 }}>×{b.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TruckView;