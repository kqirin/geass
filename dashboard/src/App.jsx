import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';

import { apiClient } from './lib/apiClient';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';

function PrivateRoute({ children }) {
  const [ok, setOk] = useState(null);

  useEffect(() => {
    let active = true;

    apiClient
      .get('/api/auth/session')
      .then((r) => {
        if (active) setOk(r.status >= 200 && r.status < 300);
      })
      .catch(() => {
        if (active) setOk(false);
      });

    return () => {
      active = false;
    };
  }, []);

  if (ok === null) return <div className="min-h-screen bg-[#0b0b14]" />;
  return ok ? children : <Navigate to="/" />;
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <PrivateRoute>
              <Dashboard />
            </PrivateRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}

