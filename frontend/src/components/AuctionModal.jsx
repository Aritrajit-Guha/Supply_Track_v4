import { useState, useEffect, useRef } from 'react';
import socket from '../services/socket';
import { useAuth } from '../context/useAuth';

export default function AuctionModal({ auctionData, onClose }) {
  const { user } = useAuth();
  const myShopId   = user?.shop_id;
  const myShopName = user?.shop_name;

  // --- NEW STATE: Check if user opted into the bidding room ---
  const [hasJoined,   setHasJoined]   = useState(false);

  const [timeLeft,    setTimeLeft]    = useState(auctionData.time_limit);
  const [currentPrice,setCurrentPrice]= useState(auctionData.current_price);
  const [customBid,   setCustomBid]   = useState(auctionData.current_price + 50);
  const [isWinning,   setIsWinning]   = useState(false);
  const [bidHistory,  setBidHistory]  = useState([]);
  const [lastBidder,  setLastBidder]  = useState('');
  const [bidRejected, setBidRejected] = useState('');
  const [auctionOver, setAuctionOver] = useState(false);
  const [result,      setResult]      = useState(null);
  const [bidFlash,    setBidFlash]    = useState(false);
  const historyRef = useRef(null);

  // Countdown timer
  useEffect(() => {
    if (timeLeft <= 0) {
      socket.emit('auction_ended', { auction_id: auctionData.auction_id });
      return;
    }
    const id = setInterval(() => setTimeLeft(p => p - 1), 1000);
    return () => clearInterval(id);
  }, [auctionData.auction_id, timeLeft]);

  // Socket listeners
  useEffect(() => {
    socket.on('price_update', (data) => {
      setCurrentPrice(data.new_price);
      setCustomBid(data.new_price + 50);
      setLastBidder(data.bidder_name);
      setIsWinning(data.bidder_id === myShopId);
      setBidHistory(data.bid_history || []);
      setBidFlash(true);
      setTimeout(() => setBidFlash(false), 600);
      setTimeout(() => {
        if (historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight;
      }, 100);
    });

    socket.on('bid_rejected', (data) => {
      setBidRejected(data.reason);
      setTimeout(() => setBidRejected(''), 3000);
    });

    socket.on('auction_result', (data) => {
      setAuctionOver(true);
      setResult(data);
      setTimeout(onClose, 6000);
    });

    return () => {
      socket.off('price_update');
      socket.off('bid_rejected');
      socket.off('auction_result');
    };
  }, [myShopId, onClose]);

  const placeBid = (amount) => {
    if (amount <= currentPrice) {
      setBidRejected(`Bid must be above ₹${currentPrice}`);
      setTimeout(() => setBidRejected(''), 2000);
      return;
    }
    socket.emit('submit_bid', {
      auction_id: auctionData.auction_id,
      shop_id:    myShopId,
      shop_name:  myShopName,
      bid_amount: amount,
    });
  };

  const timerColor = timeLeft <= 10 ? '#ef4444' : timeLeft <= 20 ? '#f59e0b' : '#ffffff';
  const urgency    = timeLeft <= 10;

  const overlayStyle = {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.88)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 9999, backdropFilter: 'blur(4px)',
  };
  
  const modalBase = {
    background: '#1e293b', borderRadius: '16px', padding: '24px',
    width: '100%', maxWidth: '460px', color: 'white',
    fontFamily: "'Segoe UI', sans-serif",
    maxHeight: '90vh', overflowY: 'auto',
  };

  // AUCTION ENDED SCREEN
  if (auctionOver && result) {
    const iWon = result.winner_id === myShopId;
    return (
      <div style={overlayStyle}>
        <div style={{ ...modalBase, border: `4px solid ${iWon ? '#22c55e' : '#475569'}`, textAlign: 'center', padding: '48px 36px' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>{iWon ? '🏆' : '😔'}</div>
          <h2 style={{ fontSize: '28px', fontWeight: 900, color: iWon ? '#4ade80' : '#94a3b8', margin: '0 0 8px' }}>
            {iWon ? 'YOU WON!' : 'Auction Ended'}
          </h2>
          {iWon
            ? <p style={{ color: '#86efac', fontSize: '15px' }}>The truck is rerouting to your shop now.</p>
            : <p style={{ color: '#64748b', fontSize: '15px' }}>Won by <strong style={{ color: '#e2e8f0' }}>{result.winner_name || 'another shop'}</strong></p>
          }
          <div style={{ background: '#0f172a', borderRadius: '12px', padding: '16px', margin: '20px 0' }}>
            <div style={{ color: '#64748b', fontSize: '13px' }}>Final Price</div>
            <div style={{ fontSize: '36px', fontWeight: 900, color: '#4ade80' }}>₹{result.final_price}</div>
          </div>
          <div style={{ color: '#475569', fontSize: '13px' }}>This window will close automatically…</div>
        </div>
      </div>
    );
  }

  // LIVE AUCTION SCREEN (Split into Invite vs Bidding)
  return (
    <div style={overlayStyle}>
      <div style={{
        ...modalBase,
        border: `4px solid ${isWinning ? '#22c55e' : urgency && hasJoined ? '#ef4444' : '#3b82f6'}`,
        boxShadow: `0 0 60px ${isWinning ? 'rgba(34,197,94,0.3)' : urgency && hasJoined ? 'rgba(239,68,68,0.4)' : 'rgba(59,130,246,0.2)'}`,
        animation: urgency && hasJoined ? 'shake 0.5s infinite' : 'none',
      }}>

        {/* Header (Always Visible) */}
        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '6px' }}>
            <span style={{ fontSize: '20px' }}>🚨</span>
            <span style={{ fontWeight: 900, fontSize: '18px', color: '#ef4444', letterSpacing: '1px' }}>FLASH AUCTION ALERT</span>
            <span style={{ fontSize: '20px' }}>🚨</span>
          </div>
          <div style={{ color: '#94a3b8', fontSize: '13px' }}>
            Truck <strong style={{ color: '#60a5fa' }}>{auctionData.truck_id}</strong> · Local Spoilage Risk
          </div>
        </div>

        {/* Batch item (Always Visible) */}
        <div style={{ background: '#0f172a', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', borderLeft: '4px solid #ef4444' }}>
          <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', marginBottom: '4px' }}>Inventory at Risk</div>
          <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '14px' }}>{auctionData.batch_item}</div>
          {auctionData.reasoning && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#93c5fd', lineHeight: 1.5 }}>
              {auctionData.reasoning}
            </div>
          )}
        </div>

        {/* --- DECISION UI (Only show if they haven't joined yet) --- */}
        {!hasJoined ? (
          <div style={{ background: '#1e293b', textAlign: 'center', padding: '10px 0' }}>
            <div style={{ fontSize: '16px', fontWeight: 800, color: 'white', marginBottom: '8px' }}>Do you want to participate?</div>
            <p style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '24px', lineHeight: 1.5 }}>
              Enter the live bidding room to secure this inventory at a massive discount. 
              <strong style={{ color: timerColor, display: 'block', marginTop: '10px', fontSize: '18px' }}>
                {timeLeft} seconds remaining to decide.
              </strong>
            </p>
            
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={onClose} style={{ flex: 1, padding: '14px', background: 'transparent', border: '2px solid #475569', color: '#cbd5e1', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
                Dismiss
              </button>
              <button onClick={() => setHasJoined(true)} style={{ flex: 2, padding: '14px', background: 'linear-gradient(135deg,#16a34a,#22c55e)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 800, fontSize: '15px', boxShadow: '0 4px 12px rgba(34,197,94,0.3)' }}>
                Enter Auction Room ➔
              </button>
            </div>
          </div>
        ) : (
          /* --- BIDDING UI (Only show if they clicked Enter) --- */
          <>
            {/* Timer + Price */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div style={{ background: '#0f172a', borderRadius: '10px', padding: '16px', textAlign: 'center', border: urgency ? '2px solid #ef4444' : '2px solid #1e293b' }}>
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', marginBottom: '4px' }}>Time Left</div>
                <div style={{ fontSize: '42px', fontWeight: 900, color: timerColor, lineHeight: 1 }}>
                  {String(Math.floor(timeLeft / 60)).padStart(2,'0')}:{String(timeLeft % 60).padStart(2,'0')}
                </div>
                {urgency && <div style={{ color: '#ef4444', fontSize: '11px', fontWeight: 700, marginTop: '4px', animation: 'pulse 0.5s infinite' }}>ENDING SOON!</div>}
              </div>

              <div style={{ background: '#0f172a', borderRadius: '10px', padding: '16px', textAlign: 'center', border: `2px solid ${bidFlash ? '#22c55e' : '#1e293b'}`, transition: 'border-color 0.3s' }}>
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', marginBottom: '4px' }}>Highest Bid</div>
                <div style={{ fontSize: '36px', fontWeight: 900, color: '#4ade80', lineHeight: 1 }}>₹{currentPrice}</div>
                <div style={{ fontSize: '11px', marginTop: '4px', color: isWinning ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                  {isWinning ? "✅ You're winning!" : lastBidder ? `by ${lastBidder}` : 'Be first to bid!'}
                </div>
              </div>
            </div>

            {/* Bid rejection error */}
            {bidRejected && (
              <div style={{ background: '#450a0a', border: '1px solid #ef4444', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', color: '#fca5a5', fontSize: '13px', fontWeight: 600, textAlign: 'center' }}>
                ❌ {bidRejected}
              </div>
            )}

            {/* Quick bid buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '8px', marginBottom: '10px' }}>
              {[50, 100, 200].map(inc => (
                <button key={inc} onClick={() => placeBid(currentPrice + inc)}
                  style={{ padding: '12px 0', background: 'linear-gradient(135deg,#1d4ed8,#2563eb)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 800, fontSize: '14px' }}>
                  +₹{inc}
                </button>
              ))}
            </div>

            {/* Custom bid */}
            <div style={{ display: 'flex', marginBottom: '16px' }}>
              <div style={{ position: 'relative', flex: 2 }}>
                <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontWeight: 700 }}>₹</span>
                <input type="number" value={customBid} onChange={e => setCustomBid(Number(e.target.value))}
                  style={{ width: '100%', padding: '13px 12px 13px 28px', background: '#0f172a', border: '2px solid #334155', borderRight: 'none', borderRadius: '8px 0 0 8px', color: 'white', fontSize: '16px', fontWeight: 700, boxSizing: 'border-box', outline: 'none' }} />
              </div>
              <button onClick={() => placeBid(customBid)}
                style={{ flex: 1, padding: '13px', background: 'linear-gradient(135deg,#dc2626,#ef4444)', color: 'white', border: 'none', borderRadius: '0 8px 8px 0', cursor: 'pointer', fontWeight: 900, fontSize: '15px' }}>
                BID NOW
              </button>
            </div>

            {/* Bid history */}
            {bidHistory.length > 0 && (
              <div style={{ background: '#0f172a', borderRadius: '10px', padding: '12px', marginBottom: '12px' }}>
                <div style={{ fontSize: '11px', color: '#475569', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 700 }}>Recent Bids</div>
                <div ref={historyRef} style={{ maxHeight: '100px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {[...bidHistory].reverse().map((b, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '4px 0', borderBottom: '1px solid #1e293b', color: b.shop_id === myShopId ? '#4ade80' : '#94a3b8' }}>
                      <span>{b.shop_id === myShopId ? '⭐ You' : b.shop_name}</span>
                      <span style={{ fontWeight: 700 }}>₹{b.amount}</span>
                      <span style={{ color: '#475569' }}>{b.time}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </  >
        )}

        {/* Footer (Always Visible) */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#475569', marginTop: hasJoined ? '0' : '16px' }}>
          <span>🏪 {myShopName}</span>
          <span>{auctionData.auction_id}</span>
          {hasJoined && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: '11px' }}>Dismiss ✕</button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-4px)} 75%{transform:translateX(4px)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0} }
      `}</style>
    </div>
  );
}
