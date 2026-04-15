import { createContext, useState, useEffect, useContext, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

const AuthContext = createContext();
export const useAuth = () => useContext(AuthContext);

const API = `${BACKEND_URL}/api`;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const token      = sessionStorage.getItem('token');
    const storedUser = sessionStorage.getItem('shopUser');
    if (token && storedUser) {
      setUser(JSON.parse(storedUser));
      // Always re-fetch fresh profile so green_credits are current
      axios.get(`${API}/auth/profile`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => {
        sessionStorage.setItem('shopUser', JSON.stringify(r.data));
        setUser(r.data);
      }).catch((err) => {
  console.error("Profile fetch failed", err);
  // fallback: still keep user from storage
  setUser(JSON.parse(storedUser));
})
  .finally(()=>setLoading(false));
    }else{
      setLoading(false);
    }
  }, []);

  const login = (token, userData) => {
    sessionStorage.setItem('token', token);
    sessionStorage.setItem('shopUser', JSON.stringify(userData));
    setUser(userData);
    navigate('/');
  };

  const logout = () => {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('shopUser');
    setUser(null);
    navigate('/auth');
  };

  // Call after placing an order to refresh green_credits live in nav
  const refreshProfile = useCallback(async () => {
    const token = sessionStorage.getItem('token');
    if (!token) return;
    try {
      const r = await axios.get(`${API}/auth/profile`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      sessionStorage.setItem('shopUser', JSON.stringify(r.data));
      setUser(r.data);
    } catch (e) {
      console.error('Could not refresh profile', e);
    }
  }, []);
  if(loading) return null;
  return (
    <AuthContext.Provider value={{ user, login, logout, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};
