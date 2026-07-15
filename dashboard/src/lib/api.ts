import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('gravvia_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    // A 401 from the login attempt itself must surface as a form error, not a
    // redirect — reloading /login here wipes the "Invalid credentials" message.
    const isLoginRequest = err.config?.url?.includes('/auth/login');
    if (
      err.response?.status === 401 &&
      typeof window !== 'undefined' &&
      !isLoginRequest &&
      window.location.pathname !== '/login'
    ) {
      localStorage.removeItem('gravvia_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);
