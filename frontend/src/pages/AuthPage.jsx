import { useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/useAuth';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

const AuthPage = () => {
  const [isLogin, setIsLogin] = useState(true);
  
  // ADDED lat and lng to our form state!
  const [formData, setFormData] = useState({ 
    email: '', password: '', shop_name: '', address: '', lat: null, lng: null 
  });
  
  const [error, setError] = useState('');
  const [locationStatus, setLocationStatus] = useState(''); // To show feedback when finding GPS
  const { login } = useAuth();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // --- NEW MAGIC FUNCTION: Get Exact GPS ---
  const handleGetLocation = (e) => {
    e.preventDefault(); // Stop form submission
    setLocationStatus("Locating satellite...");

    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setFormData({ 
            ...formData, 
            lat: position.coords.latitude, 
            lng: position.coords.longitude 
          });
          setLocationStatus(`✅ GPS Locked: ${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`);
        },
        (error) => {
          console.error("Error getting location:", error);
          setLocationStatus("❌ Location access denied. Please type address manually.");
        }
      );
    } else {
      setLocationStatus("❌ Geolocation not supported by your browser.");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    // Safety check: Don't let them register without a location!
    if (!isLogin && !formData.lat) {
      setError("Please click 'Get My Location' so the supply trucks can find you!");
      return;
    }

    const url = isLogin ? `${BACKEND_URL}/api/auth/login` : `${BACKEND_URL}/api/auth/register`;

    try {
      const response = await api.post(url, formData);
      login(response.data.token, response.data.shop); 
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Is Flask running?');
    }
  };

  const inputStyle = { width: '100%', padding: '12px', margin: '10px 0', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#0f172a', fontFamily: 'sans-serif' }}>
      <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '12px', width: '100%', maxWidth: '400px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
        
        <h2 style={{ textAlign: 'center', color: '#1e293b', marginBottom: '10px' }}>
          {isLogin ? 'Welcome Back' : 'Register Your Shop'}
        </h2>
        <p style={{ textAlign: 'center', color: '#64748b', marginBottom: '30px' }}>Smart Supply Chain Portal</p>

        {error && <div style={{ backgroundColor: '#fee2e2', color: '#ef4444', padding: '10px', borderRadius: '6px', marginBottom: '15px', textAlign: 'center', fontWeight: 'bold' }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          {!isLogin && (
            <>
              <input name="shop_name" placeholder="Shop Name" onChange={handleChange} required style={inputStyle} />
              <input name="address" placeholder="Store Address" onChange={handleChange} required style={inputStyle} />
              
              {/* --- NEW GPS BUTTON --- */}
              <div style={{ margin: '10px 0', padding: '10px', backgroundColor: '#f1f5f9', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <p style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#475569', fontWeight: 'bold' }}>Geofence Setup</p>
                <button 
                  onClick={handleGetLocation} 
                  style={{ width: '100%', padding: '10px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
                >
                  📍 Get My Exact Coordinates
                </button>
                {locationStatus && <p style={{ fontSize: '12px', margin: '10px 0 0 0', color: formData.lat ? '#10b981' : '#ef4444', textAlign: 'center' }}>{locationStatus}</p>}
              </div>
            </>
          )}

          <input name="email" type="email" placeholder="Email" onChange={handleChange} required style={inputStyle} />
          <input name="password" type="password" placeholder="Password" onChange={handleChange} required style={inputStyle} />
          
          <button type="submit" style={{ width: '100%', padding: '14px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', marginTop: '15px' }}>
            {isLogin ? 'Login to Dashboard' : 'Create Account'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <button onClick={() => setIsLogin(!isLogin)} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', textDecoration: 'underline' }}>
            {isLogin ? "Don't have an account? Register" : "Already have an account? Login"}
          </button>
        </div>

      </div>
    </div>
  );
};

export default AuthPage;
