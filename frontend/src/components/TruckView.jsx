import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import socket from '../services/socket';
import './TruckView.css';

const TruckView = () => {
  const [hoveredBatch, setHoveredBatch] = useState(null);
  const [selectedBatchId, setSelectedBatchId] = useState(null);
  const [truckData, setTruckData] = useState(null);
  const [cargoBatches, setCargoBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [auctionNotice, setAuctionNotice] = useState(null);

  const { id } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchCargo = (showLoader = false) => {
      if (showLoader) {
        setLoading(true);
      }

      api.get(`/truck/cargo/${id}`)
        .then((r) => {
          setTruckData(r.data.truck);
          setCargoBatches(r.data.cargo);
          setSelectedBatchId((current) => {
            if (!r.data.cargo.length) {
              return null;
            }
            if (current && r.data.cargo.some((batch) => batch.id === current)) {
              return current;
            }
            return r.data.cargo[0].id;
          });
          setError('');
          setLoading(false);
        })
        .catch((err) => {
          setError('Could not load cargo data. Is Flask running?');
          setLoading(false);
          console.error(err);
        });
    };

    fetchCargo(true);
    const intervalId = setInterval(() => fetchCargo(false), 10000);
    return () => clearInterval(intervalId);
  }, [id]);

  useEffect(() => {
    const handleAuctionResult = (data) => {
      if (!data?.source_order_id) {
        return;
      }

      const affectedBatch = cargoBatches.find((batch) => batch.order_id === data.source_order_id);
      if (!affectedBatch) {
        return;
      }

      setAuctionNotice({
        tone: data.order_transferred ? 'danger' : 'info',
        message: data.order_transferred
          ? `${data.winner_name || 'Another shop'} won the auction for ${affectedBatch.name}. This batch has been removed from your active fleet.`
          : `The auction for ${affectedBatch.name} has ended.`,
      });

      api.get(`/truck/cargo/${id}`)
        .then((r) => {
          setTruckData(r.data.truck);
          setCargoBatches(r.data.cargo);
          setSelectedBatchId((current) => r.data.cargo.some((batch) => batch.id === current) ? current : (r.data.cargo[0]?.id || null));
        })
        .catch(() => {});

      setTimeout(() => setAuctionNotice(null), 7000);
    };

    socket.on('auction_result', handleAuctionResult);
    return () => {
      socket.off('auction_result', handleAuctionResult);
    };
  }, [cargoBatches, id]);

  const handleTriggerAuction = async (batch) => {
    try {
      await api.post('/auction/trigger', {
        auction_id: `A-${batch.id}`,
        truck_id: id,
        batch_item: `${batch.quantity} x ${batch.name} (${batch.unit}) - Temp: ${batch.temp}C`,
        base_price: 500,
        truck_lat: truckData?.lat || 23.5742,
        truck_lng: truckData?.lng || 87.3203,
        source_shop_id: batch.shop_id,
        source_shop_name: batch.shop_name,
        source_order_id: batch.order_id,
        product_id: batch.product_id,
      });
      alert(`Auction triggered for ${batch.name}. Nearby shops were notified.`);
    } catch (err) {
      console.error(err);
      alert('Failed to trigger auction.');
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f1f5f9', fontFamily: 'sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>Truck</div>
          <div style={{ fontSize: '18px', color: '#64748b', fontWeight: 700 }}>Loading IoT cargo data...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f1f5f9', fontFamily: 'sans-serif' }}>
        <div style={{ textAlign: 'center', maxWidth: '400px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>Error</div>
          <div style={{ fontSize: '18px', color: '#ef4444', fontWeight: 700, marginBottom: '16px' }}>{error}</div>
          <button onClick={() => navigate('/fleet')} style={{ background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', padding: '12px 24px', cursor: 'pointer', fontWeight: 700 }}>
            Back to Fleet
          </button>
        </div>
      </div>
    );
  }

  if (cargoBatches.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f1f5f9', fontFamily: 'sans-serif', padding: '20px' }}>
        <div style={{ textAlign: 'center', maxWidth: '400px' }}>
          <div style={{ fontSize: '56px', marginBottom: '16px' }}>Cargo</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>No cargo for your shop on {id}</div>
          <div style={{ fontSize: '14px', color: '#64748b', marginBottom: '24px' }}>
            This truck has no active order batches for your shop right now.
          </div>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <button onClick={() => navigate('/')} style={{ background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', padding: '12px 24px', cursor: 'pointer', fontWeight: 700 }}>
              Place an Order
            </button>
            <button onClick={() => navigate('/fleet')} style={{ background: 'white', color: '#475569', border: '2px solid #e2e8f0', borderRadius: '8px', padding: '12px 24px', cursor: 'pointer', fontWeight: 700 }}>
              Fleet
            </button>
          </div>
        </div>
      </div>
    );
  }

  const truck = truckData || {};
  const truckRisk = truck.risk_summary || null;
  const selectedBatch = cargoBatches.find((batch) => batch.id === selectedBatchId) || null;
  const activeBatch = hoveredBatch || selectedBatch;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontFamily: 'sans-serif', padding: '20px', backgroundColor: '#f1f5f9', minHeight: '100vh' }}>
      <div style={{ width: '100%', maxWidth: '900px', marginBottom: '20px' }}>
        <button
          onClick={() => navigate('/fleet')}
          style={{ padding: '10px 20px', backgroundColor: '#334155', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', color: 'white', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          Back to Fleet Dashboard
        </button>
      </div>

      <div style={{ backgroundColor: '#0f172a', color: 'white', padding: '20px 40px', borderRadius: '12px', marginBottom: '30px', textAlign: 'center', width: '100%', maxWidth: '800px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
        <h1 style={{ margin: '0 0 8px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
          <span style={{ color: '#3b82f6' }}>LIVE TRACKING:</span> {id}
        </h1>
        <div style={{ fontSize: '14px', color: '#64748b', marginBottom: '12px' }}>
          Driver: <strong style={{ color: '#94a3b8' }}>{truck.driver}</strong>
          {' '}|{' '}
          {cargoBatches.length} batch{cargoBatches.length !== 1 ? 'es' : ''} for your shop
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', color: '#cbd5e1', fontWeight: 'bold', flexWrap: 'wrap', gap: '8px' }}>
          <span>Destination: {truck.destination || 'En Route'}</span>
          <span>{truck.distance_left_km} km remaining</span>
          <span>ETA: {truck.eta_hours}h</span>
          <span>Cabin: {truck.current_temperature}C</span>
          <span>Status: {truck.status}</span>
        </div>
        {truckRisk && (
          <div style={{ marginTop: '14px', background: 'rgba(15,23,42,0.55)', border: `1px solid ${truckRisk.level === 'critical' ? '#ef4444' : truckRisk.level === 'warning' ? '#f59e0b' : truckRisk.level === 'watch' ? '#facc15' : '#22c55e'}`, borderRadius: '10px', padding: '12px 14px', textAlign: 'left' }}>
            <div style={{ fontSize: '12px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: '4px' }}>Spoilage Risk Summary</div>
            <div style={{ fontSize: '18px', fontWeight: 800, marginBottom: '4px' }}>{truckRisk.level.toUpperCase()} · {truckRisk.score}/100</div>
            <div style={{ color: '#cbd5e1', fontSize: '13px', marginBottom: '4px' }}>{truckRisk.summary}</div>
            <div style={{ color: '#93c5fd', fontSize: '13px' }}>Recommended: {truckRisk.recommended_action}</div>
          </div>
        )}
      </div>

      {auctionNotice && (
        <div style={{
          width: '100%',
          maxWidth: '800px',
          marginBottom: '16px',
          background: auctionNotice.tone === 'danger' ? '#450a0a' : '#0f172a',
          color: 'white',
          border: `1px solid ${auctionNotice.tone === 'danger' ? '#ef4444' : '#334155'}`,
          borderRadius: '10px',
          padding: '12px 16px',
          boxShadow: '0 12px 28px rgba(0,0,0,0.16)',
        }}>
          <div style={{ fontSize: '13px', lineHeight: 1.5 }}>{auctionNotice.message}</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '40px', alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'center' }}>
        <div className="animated-road" style={{ width: '360px', height: '700px', padding: '20px', borderRadius: '16px', display: 'flex', justifyContent: 'center', overflow: 'hidden', boxShadow: 'inset 0 0 50px rgba(0,0,0,0.5)' }}>
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

              <div className="cargo-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', overflowY: 'auto', flex: 1, padding: '4px' }}>
                {cargoBatches.map((batch) => (
                  <div
                    key={batch.id}
                    onMouseEnter={() => setHoveredBatch(batch)}
                    onMouseLeave={() => setHoveredBatch(null)}
                    onClick={() => setSelectedBatchId(batch.id)}
                    style={{
                      gridRow: `span ${batch.spanRow}`,
                      gridColumn: `span ${batch.spanCol}`,
                      backgroundImage: `linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.7)), url(${batch.image})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      border: batch.id === selectedBatchId ? '3px solid #3b82f6' : batch.isSpoiling ? '3px solid #ef4444' : '2px solid #94a3b8',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      minHeight: '75px',
                      position: 'relative',
                      boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
                    }}
                  >
                    {batch.isSpoiling && (
                      <div style={{ position: 'absolute', top: -5, right: -5, backgroundColor: '#ef4444', color: 'white', padding: '4px 6px', fontSize: '10px', fontWeight: '900', borderRadius: '4px', border: '2px solid white', zIndex: 5, animation: 'pulse 1.5s infinite' }}>
                        ALERT
                      </div>
                    )}
                    <div style={{ position: 'absolute', bottom: '5px', left: '5px', color: 'white', fontSize: '10px', fontWeight: 'bold', backgroundColor: 'rgba(0,0,0,0.7)', padding: '2px 5px', borderRadius: '4px', lineHeight: 1.3 }}>
                      <div>{batch.product_id}</div>
                      <div style={{ color: '#94a3b8' }}>x{batch.quantity}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div style={{ width: '380px', backgroundColor: 'white', border: '1px solid #cbd5e1', borderRadius: '12px', padding: '25px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
          <h3 style={{ marginTop: 0, borderBottom: '3px solid #f1f5f9', paddingBottom: '15px', color: '#1e293b', fontSize: '20px' }}>
            IoT Batch Diagnostics
          </h3>

          {activeBatch ? (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '10px' }}>
                <div style={{ fontSize: '12px', color: '#64748b' }}>
                  {hoveredBatch ? 'Hover preview active' : 'Pinned batch selected'}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedBatchId(null)}
                  style={{ background: 'white', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', fontSize: '12px', fontWeight: 700, color: '#475569' }}
                >
                  Clear Selection
                </button>
              </div>

              <div style={{ height: '120px', width: '100%', backgroundImage: `url(${activeBatch.image})`, backgroundSize: 'cover', backgroundPosition: 'center', borderRadius: '8px', marginBottom: '15px' }} />

              <h2 style={{ color: activeBatch.isSpoiling ? '#ef4444' : '#0f172a', margin: '0 0 4px', fontSize: '20px' }}>{activeBatch.name}</h2>
              <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '4px' }}>Supplier: {activeBatch.supplier}</div>
              <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '12px' }}>Order: {activeBatch.order_id}</div>

              <div style={{ background: '#eff6ff', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#1d4ed8', fontWeight: 700 }}>Your Order Qty</span>
                <span style={{ fontWeight: 900, fontSize: '18px', color: '#0f172a' }}>{activeBatch.quantity} x {activeBatch.unit}</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#f8fafc', padding: '15px', borderRadius: '8px', marginBottom: '12px' }}>
                <span style={{ fontSize: '32px', marginRight: '15px' }}>Temp</span>
                <div>
                  <div style={{ fontSize: '13px', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}>Sensor Temp</div>
                  <div style={{ fontSize: '28px', fontWeight: '900', color: activeBatch.isSpoiling ? '#ef4444' : '#10b981' }}>
                    {activeBatch.temp}C
                  </div>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>Safe: {activeBatch.storage_temp}</div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px', marginBottom: '10px' }}>
                <span style={{ color: '#64748b' }}>Health Status:</span>
                <span style={{ color: activeBatch.isSpoiling ? '#ef4444' : '#10b981', fontWeight: 'bold' }}>{activeBatch.health}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px', marginBottom: '10px' }}>
                <span style={{ color: '#64748b' }}>Risk Score:</span>
                <span style={{ color: activeBatch.risk?.level === 'critical' ? '#ef4444' : activeBatch.risk?.level === 'warning' ? '#f59e0b' : '#0f172a', fontWeight: 'bold' }}>
                  {(activeBatch.risk?.level || 'safe').toUpperCase()} · {activeBatch.risk?.score || 0}/100
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                <span style={{ color: '#64748b' }}>Shelf Life:</span>
                <span style={{ fontWeight: 'bold', color: '#0f172a' }}>{activeBatch.expiry}</span>
              </div>
              <div style={{ backgroundColor: '#f8fafc', borderRadius: '8px', padding: '12px 14px', marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '6px' }}>Risk Explanation</div>
                <div style={{ fontSize: '13px', color: '#334155', lineHeight: 1.5 }}>{activeBatch.risk?.summary}</div>
              </div>
              <div style={{ backgroundColor: '#eff6ff', borderRadius: '8px', padding: '12px 14px', marginBottom: '20px' }}>
                <div style={{ fontSize: '12px', color: '#1d4ed8', fontWeight: 700, textTransform: 'uppercase', marginBottom: '6px' }}>Recommended Action</div>
                <div style={{ fontSize: '13px', color: '#1e3a8a', lineHeight: 1.5 }}>{activeBatch.risk?.recommended_action}</div>
                {!!activeBatch.risk?.reasons?.length && (
                  <div style={{ marginTop: '10px', fontSize: '12px', color: '#475569' }}>
                    Key signals: {activeBatch.risk.reasons.join(' ')}
                  </div>
                )}
              </div>

              {activeBatch.isSpoiling && (
                <button
                  onClick={() => handleTriggerAuction(activeBatch)}
                  style={{ backgroundColor: '#ef4444', color: 'white', border: 'none', padding: '15px', width: '100%', borderRadius: '8px', fontSize: '16px', fontWeight: '900', cursor: 'pointer', boxShadow: '0 4px 6px rgba(239,68,68,0.3)' }}
                >
                  TRIGGER FLASH AUCTION
                </button>
              )}
            </div>
          ) : (
            <div style={{ color: '#94a3b8', textAlign: 'center', marginTop: '40px', padding: '20px' }}>
              <span style={{ fontSize: '50px', display: 'block', marginBottom: '15px' }}>Hover</span>
              <p style={{ fontSize: '16px', lineHeight: '1.5' }}>
                Hover over the cargo grid to preview a batch, or click one to pin it and keep the controls visible.
              </p>
              <div style={{ marginTop: '20px', background: '#f8fafc', borderRadius: '10px', padding: '14px', textAlign: 'left' }}>
                <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }}>Your cargo on this truck</div>
                {cargoBatches.map((batch) => (
                  <div key={batch.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '4px 0', borderBottom: '1px solid #f1f5f9', color: batch.isSpoiling ? '#ef4444' : '#475569' }}>
                    <span>{(batch.risk?.level || 'safe').toUpperCase()} {batch.name}</span>
                    <span style={{ fontWeight: 700 }}>{batch.risk?.score || 0}/100</span>
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
