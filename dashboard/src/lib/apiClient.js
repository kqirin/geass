import axios from 'axios';

const metaEnv = typeof import.meta !== 'undefined' && import.meta?.env ? import.meta.env : {};
const API_BASE = metaEnv.VITE_API_BASE || 'http://localhost:3000';

export const apiClient = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  timeout: 15_000,
});

export function extractApiError(error, fallback = 'İşlem başarısız') {
  return error?.response?.data?.error || fallback;
}

export function extractRequestId(error) {
  return error?.response?.data?.requestId || null;
}

