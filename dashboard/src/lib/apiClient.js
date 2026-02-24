import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

export const apiClient = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  timeout: 15_000,
});

export function extractApiError(error, fallback = 'Islem basarisiz') {
  return error?.response?.data?.error || fallback;
}

export function extractRequestId(error) {
  return error?.response?.data?.requestId || null;
}

