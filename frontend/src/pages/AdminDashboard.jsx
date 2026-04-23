import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import socket from '../services/socket';
import AuctionModal from '../components/AuctionModal';
import AIChatWidget from '../components/AIChatWidget';
import { useAuth } from '../context/AuthContext';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const haversine = (lat1, lon1, lat2, lon2) => {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

const ALERT_STYLES = {
  normal:   { border: '#22c55e', badge: '#dcfce7', badgeText: '#166534', label: '● Normal'   },
  warning:  { border: '#f59e0b', badge: '#fef9c3', badgeText: '#854d0e', label: '● Warning'  },
  critical: { border: '#ef4444', badge: '#fee2e2', badgeText: '#991b1b', label: '● Critical' },
};

const STATUS_ICON = { 'In Transit': '🚛', 'Loading': '📦', 'Delivered': '✅', 'Delayed': '⚠️' };

function makeTruckIcon(color, isSelected) {
  const size = isSelected ? 44 : 36;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 44 44">
    <circle cx="22" cy="22" r="20" fill="${color}" stroke="white" stroke-width="3" opacity="${isSelected ? 1 : 0.85}"/>
    ${isSelected ? `<circle cx="22" cy="22" r="20" fill="none" stroke="${color}" stroke-width="6" opacity="0.3"/>` : ''}
    <text x="22" y="28" text-anchor="middle" font-size="18">🚛</text>
  </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2], popupAnchor: [0, -size/2] });
}

function MapFlyTo({ trucks, selectedId }) {
  const map = useMap();
  useEffect(() => {
    const t = trucks.find(x => x.truck_id === selectedId);
    if (t) map.flyTo([t.lat, t.lng], 10, { duration: 1.2 });
  }, [selectedId, trucks, map]);
  return null;
}

function TruckMap({ trucks, selectedId, onSelectTruck }) {
  return (
    <div style={{ borderRadius: '14px', overflow: 'hidden', border: '2px solid #1e3a5f', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
      <div style={{ background: '#0f172a', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #1e3a5f' }}>
        <span>🗺️</span>
        <span style={{ color: '#94a3b8', fontSize: '13px', fontWeight: 700 }}>LIVE FLEET MAP — West Bengal / Jharkhand Corridor</span>
        <span style={{ marginLeft: 'auto', background: '#dc2626', color: 'white', borderRadius: '20px', padding: '2px 10px', fontSize: '11px', fontWeight: 800, animation: 'pulse 2s infinite' }}>● LIVE</span>
      </div>

      <MapContainer center={[23.5, 87.2]} zoom={9} style={{ height: '340px', width: '100%' }} zoomControl={true}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapFlyTo trucks={trucks} selectedId={selectedId} />
        {trucks.map(truck => {
          const color = truck.alert_level === 'critical' ? '#ef4444' : truck.alert_level === 'warning' ? '#f59e0b' : '#22c55e';
          return (
            <Marker key={truck.truck_id} position={[truck.lat, truck.lng]}
              icon={makeTruckIcon(color, truck.truck_id === selectedId)}
              eventHandlers={{ click: () => onSelectTruck(truck.truck_id) }}>
              <Popup>
                <div style={{ minWidth: '180px', fontFamily: 'sans-serif' }}>
                  <div style={{ fontWeight: 900, fontSize: '15px', marginBottom: '6px' }}>🚛 {truck.truck_id}</div>
                  <div style={{ fontSize: '12px', color: '#475569', marginBottom: '4px' }}>👤 {truck.driver}</div>
                  <div style={{ fontSize: '12px', marginBottom: '4px' }}><strong>Cargo:</strong> {truck.cargo_type}</div>
                  <div style={{ fontSize: '12px', marginBottom: '4px' }}>
                    <strong>Temp:</strong> <span style={{ color: truck.current_temperature > 8 ? '#ef4444' : '#16a34a', fontWeight: 700 }}>{truck.current_temperature}°C</span>
                  </div>
                  <div style={{ fontSize: '12px', marginBottom: '4px' }}><strong>ETA:</strong> {truck.eta_hours}h · {truck.distance_left_km} km left</div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>{truck.origin} → {truck.destination}</div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      <div style={{ background: '#0a1628', padding: '8px 16px', display: 'flex', gap: '20px', borderTop: '1px solid #1e3a5f' }}>
        {[['#22c55e','Normal'],['#f59e0b','Warning'],['#ef4444','Critical']].map(([c,l]) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#64748b' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: c }} />{l}
          </div>
        ))}
        <div style={{ marginLeft: 'auto', fontSize: '11px', color: '#475569' }}>Click a marker to select truck</div>
      </div>
    </div>
  );
}

function TruckCard({ truck, isSelected, onClick, onInspect }) {
  const al     = ALERT_STYLES[truck.alert_level] || ALERT_STYLES.normal;
  const progress = Math.round(100 - (truck.distance_left_km / (truck.distance_left_km + 50)) * 100);

  return (
    <div onClick={onClick} style={{ background: isSelected ? '#0f172a' : '#111827', borderRadius: '16px', border: `2px solid ${isSelected ? al.border : '#1e293b'}`, overflow: 'hidden', cursor: 'pointer', transition: 'all 0.2s', boxShadow: isSelected ? `0 0 24px ${al.border}33` : '0 4px 12px rgba(0,0,0,0.3)' }}>
      <div style={{ height: '100px', position: 'relative', overflow: 'hidden' }}>
        <img src={truck.cargo_image} alt={truck.cargo_type} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.5)' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 30%, #111827 100%)' }} />
        <div style={{ position: 'absolute', top: '10px', left: '10px', background: al.badge, color: al.badgeText, borderRadius: '20px', padding: '3px 10px', fontSize: '11px', fontWeight: 800 }}>{al.label}</div>
        <div style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(0,0,0,0.7)', color: 'white', borderRadius: '8px', padding: '3px 10px', fontSize: '13px', fontWeight: 900 }}>{truck.truck_id}</div>
        <div style={{ position: 'absolute', bottom: '10px', left: '12px', color: 'white', fontWeight: 800, fontSize: '15px' }}>{truck.cargo_type}</div>
      </div>

      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div style={{ fontSize: '13px', color: '#94a3b8' }}>👤 {truck.driver}</div>
          <div style={{ fontSize: '13px', color: '#60a5fa', fontWeight: 700 }}>{STATUS_ICON[truck.status]} {truck.status}</div>
        </div>

        <div style={{ background: '#0f172a', borderRadius: '8px', padding: '8px 12px', marginBottom: '10px', fontSize: '12px' }}>
          <div style={{ color: '#64748b', marginBottom: '3px' }}>ROUTE</div>
          <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{truck.origin} <span style={{ color: '#3b82f6' }}>→</span> {truck.destination}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '8px', marginBottom: '10px' }}>
          {[
            { icon: '🌡️', val: `${truck.current_temperature}°C`, label: 'Temp', warn: truck.current_temperature > 8 },
            { icon: '💧', val: `${truck.humidity}%`, label: 'Humidity' },
            { icon: '⏱️', val: `${truck.eta_hours}h`, label: 'ETA' },
          ].map(s => (
            <div key={s.label} style={{ background: '#0a1628', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '16px' }}>{s.icon}</div>
              <div style={{ fontWeight: 800, fontSize: '14px', color: s.warn ? '#ef4444' : '#f1f5f9' }}>{s.val}</div>
              <div style={{ fontSize: '10px', color: '#475569', textTransform: 'uppercase' }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
            <span>{truck.distance_left_km} km remaining</span><span>{truck.speed_kmh} km/h</span>
          </div>
          <div style={{ height: '6px', background: '#1e293b', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: `linear-gradient(90deg,#3b82f6,${al.border})`, borderRadius: '3px', transition: 'width 0.8s ease' }} />
          </div>
        </div>

        <button onClick={e => { e.stopPropagation(); onInspect(truck.truck_id); }}
          style={{ width: '100%', padding: '10px', background: isSelected ? 'linear-gradient(135deg,#1d4ed8,#3b82f6)' : '#1e293b', color: isSelected ? 'white' : '#94a3b8', border: `1px solid ${isSelected ? '#3b82f6' : '#334155'}`, borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '13px' }}>
          🔍 Inspect Cargo Diagnostics →
        </button>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const [fleet,         setFleet]         = useState([]);
  const [selectedTruck, setSelectedTruck] = useState(null);
  const [activeAuction, setActiveAuction] = useState(null);
  const [greenCredits,  setGreenCredits]  = useState(0);
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  useEffect(() => {
    // 1. We removed the hardcoded mock data!
    api.get(`/truck/fleet`)
      .then(r => {
        setFleet(r.data);
        if (r.data.length > 0) {
          setSelectedTruck(r.data[0].truck_id);
        } else {
          setSelectedTruck(null);
        }
        const total = r.data.reduce((s, t) => s + (t.green_credits_earned || 0), 0);
        setGreenCredits(total + (user?.green_credits || 0));
      })
      .catch((e) => console.error("Error fetching fleet:", e));

    socket.on('emergency_auction_started', (data) => {
      if (!user?.lat || !user?.lng) return;
      if (haversine(user.lat, user.lng, data.truck_lat, data.truck_lng) <= 15) // Reverting your hackathon fix back to 15km
        setActiveAuction(data);
    });
    return () => socket.off('emergency_auction_started');
  }, [user]);

  const criticalCount = fleet.filter(t => t.alert_level === 'critical').length;
  const warningCount  = fleet.filter(t => t.alert_level === 'warning').length;
  const inTransit     = fleet.filter(t => t.status === 'In Transit').length;

  return (
    <div style={{ minHeight: '100vh', background: '#060d18', fontFamily: "'Segoe UI',sans-serif", color: 'white' }}>

      <nav style={{ background: 'linear-gradient(90deg,#0a1628,#0f2040)', borderBottom: '1px solid #1e3a5f', padding: '0 28px', height: '62px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ fontSize: '22px' }}>🌿</div>
          <div>
            <div style={{ fontWeight: 900, fontSize: '16px', color: '#f1f5f9' }}>LiveTrack</div>
            <div style={{ fontSize: '11px', color: '#3b82f6', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>Fleet Command</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: 'linear-gradient(135deg,#064e3b,#065f46)', border: '1px solid #059669', borderRadius: '20px', padding: '6px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>🌱</span>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 900, color: '#4ade80', lineHeight: 1 }}>{greenCredits}</div>
              <div style={{ fontSize: '9px', color: '#6ee7b7', textTransform: 'uppercase' }}>Green Credits</div>
            </div>
          </div>
          <div style={{ height: '32px', width: '1px', background: '#1e3a5f' }} />
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#e2e8f0' }}>{user?.shop_name}</div>
            <div style={{ fontSize: '11px', color: '#475569' }}>{user?.shop_id}</div>
          </div>
          <button onClick={() => navigate('/')} style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', padding: '7px 14px', cursor: 'pointer', fontSize: '13px', fontWeight: 700 }}>🛒 Shop</button>
          <button onClick={logout} style={{ background: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '8px', padding: '7px 14px', cursor: 'pointer', fontSize: '13px', fontWeight: 700 }}>Exit</button>
        </div>
      </nav>

      <div style={{ maxWidth: '1300px', margin: '0 auto', padding: '24px' }}>

        {/* Top Stats Bar */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
          {[
            { label:'Active Trucks', val: fleet.length, icon:'🚛', color:'#3b82f6', bg:'rgba(59,130,246,0.1)',  border:'rgba(59,130,246,0.25)'  },
            { label:'In Transit',    val: inTransit,    icon:'🛣️', color:'#8b5cf6', bg:'rgba(139,92,246,0.1)', border:'rgba(139,92,246,0.25)'  },
            { label:'Warnings',      val: warningCount, icon:'⚠️', color:'#f59e0b', bg:'rgba(245,158,11,0.1)', border:'rgba(245,158,11,0.25)'  },
            { label:'Critical',      val: criticalCount,icon:'🚨', color:'#ef4444', bg:'rgba(239,68,68,0.1)',  border:'rgba(239,68,68,0.25)'   },
          ].map(s => (
            <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: '12px', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '12px', minWidth: '140px' }}>
              <span style={{ fontSize: '24px' }}>{s.icon}</span>
              <div>
                <div style={{ fontSize: '24px', fontWeight: 900, color: s.color, lineHeight: 1 }}>{s.val}</div>
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase' }}>{s.label}</div>
              </div>
            </div>
          ))}
          <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '12px', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '12px', marginLeft: 'auto' }}>
            <span style={{ fontSize: '24px' }}>♻️</span>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 800, color: '#4ade80' }}>{Math.round(greenCredits * 2.3)} kg CO₂ saved</div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>via smart routing</div>
            </div>
          </div>
        </div>

        {/* 2. THE EMPTY STATE UI */}
        {fleet.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '100px 20px', background: '#0a1628', borderRadius: '16px', border: '1px dashed #1e3a5f', marginTop: '20px' }}>
             <div style={{ fontSize: '64px', marginBottom: '16px' }}>🚛</div>
             <h2 style={{ fontSize: '28px', color: '#f1f5f9', margin: '0 0 12px 0' }}>No Active Deliveries</h2>
             <p style={{ color: '#94a3b8', marginBottom: '24px', fontSize: '16px' }}>You currently have no orders in transit. Place a wholesale order to start tracking your LiveTrack fleet.</p>
             <button onClick={() => navigate('/')} style={{ background: 'linear-gradient(135deg,#1d4ed8,#3b82f6)', color: 'white', border: 'none', borderRadius: '10px', padding: '14px 28px', cursor: 'pointer', fontWeight: 800, fontSize: '16px', boxShadow: '0 8px 24px rgba(59,130,246,0.2)' }}>
               🛒 Go to Wholesale Catalogue
             </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '20px', alignItems: 'start' }}>
            <div>
              <TruckMap trucks={fleet} selectedId={selectedTruck} onSelectTruck={setSelectedTruck} />

              {selectedTruck && (() => {
                const t  = fleet.find(x => x.truck_id === selectedTruck);
                if (!t) return null;
                const al = ALERT_STYLES[t.alert_level] || ALERT_STYLES.normal;
                return (
                  <div style={{ marginTop: '16px', background: '#0a1628', borderRadius: '14px', border: `1px solid ${al.border}33`, padding: '20px', display: 'flex', gap: '20px', alignItems: 'center' }}>
                    <img src={t.cargo_image} alt="" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '10px', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 900, fontSize: '18px', marginBottom: '4px' }}>{t.truck_id} — {t.cargo_type}</div>
                      <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '8px' }}>{t.origin} → {t.destination}</div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {[`🌡️ ${t.current_temperature}°C`, `⏱️ ETA ${t.eta_hours}h`, `📍 ${t.distance_left_km} km left`, `👤 ${t.driver}`].map(tag => (
                          <span key={tag} style={{ background: '#1e293b', color: '#94a3b8', borderRadius: '6px', padding: '3px 10px', fontSize: '12px' }}>{tag}</span>
                        ))}
                      </div>
                    </div>
                    <button onClick={() => navigate(`/truck/${t.truck_id}`)}
                      style={{ background: 'linear-gradient(135deg,#1d4ed8,#3b82f6)', color: 'white', border: 'none', borderRadius: '10px', padding: '12px 20px', cursor: 'pointer', fontWeight: 800, fontSize: '13px', flexShrink: 0, boxShadow: '0 4px 16px rgba(59,130,246,0.35)' }}>
                      Open IoT<br/>Dashboard →
                    </button>
                  </div>
                );
              })()}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '12px', color: '#475569', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700, marginBottom: '4px' }}>
                Fleet — {fleet.length} vehicles
              </div>
              {fleet.map(truck => (
                <TruckCard key={truck.truck_id} truck={truck}
                  isSelected={selectedTruck === truck.truck_id}
                  onClick={() => setSelectedTruck(truck.truck_id)}
                  onInspect={id => navigate(`/truck/${id}`)} />
              ))}
            </div>
          </div>
        )}
      </div>

      {activeAuction && <AuctionModal auctionData={activeAuction} onClose={() => setActiveAuction(null)} />}
      <AIChatWidget page="fleet" accent="dark" />

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .leaflet-container { background: #0d1f35 !important; }
      `}</style>
    </div>
  );
}
