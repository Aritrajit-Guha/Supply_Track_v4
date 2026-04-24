import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from './AuthContextValue';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

const API = `${BACKEND_URL}/api`;

function getStoredUser() {
  const storedUser = sessionStorage.getItem('shopUser');
  return storedUser ? JSON.parse(storedUser) : null;
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => getStoredUser());
  const [loading, setLoading] = useState(() => Boolean(sessionStorage.getItem('token') && getStoredUser()));
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;
    const token      = sessionStorage.getItem('token');
    const storedUser = getStoredUser();
    if (token && storedUser) {
      // Always re-fetch fresh profile so green_credits are current
      axios.get(`${API}/auth/profile`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => {
        if (!isMounted) return;
        sessionStorage.setItem('shopUser', JSON.stringify(r.data));
        setUser(r.data);
      }).catch((err) => {
        if (!isMounted) return;
        console.error("Profile fetch failed", err);
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });
    }

    return () => {
      isMounted = false;
    };
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
  if (loading) return null;
  return (
    <AuthContext.Provider value={{ user, login, logout, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};
