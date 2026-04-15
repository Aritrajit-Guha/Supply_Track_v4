import axios from 'axios';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

const instance = axios.create({
  baseURL: `${BACKEND_URL}/api`,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 🔑 Attach token to every request
instance.interceptors.request.use(
  (config) => {
    const token = sessionStorage.getItem('token'); // ✅ correct storage
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

export default instance;