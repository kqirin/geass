import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';

import { getAuthStatus } from './lib/apiClient';
import {
  ROOT_AUTH_ROUTE_STATES,
  deriveRootAuthRouteState,
  toRootAuthNotice,
} from './lib/authRouteState';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';

function RootRouteView({ routeDecision }) {
  const normalizedRouteState = routeDecision?.routeState || ROOT_AUTH_ROUTE_STATES.LOADING;
  if (normalizedRouteState === ROOT_AUTH_ROUTE_STATES.DASHBOARD) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <Login
      isCheckingAuth={normalizedRouteState === ROOT_AUTH_ROUTE_STATES.LOADING}
      authNotice={toRootAuthNotice(routeDecision)}
    />
  );
}

function RootAuthRouteGate() {
  const [routeDecision, setRouteDecision] = useState({
    routeState: ROOT_AUTH_ROUTE_STATES.LOADING,
    reasonCode: null,
    message: null,
  });

  useEffect(() => {
    let isActive = true;

    async function resolveAuthStatus() {
      try {
        const authStatus = await getAuthStatus();
        if (!isActive) return;
        setRouteDecision(deriveRootAuthRouteState({ authStatus }));
      } catch (error) {
        if (!isActive) return;
        setRouteDecision(deriveRootAuthRouteState({ error }));
      }
    }

    void resolveAuthStatus();
    return () => {
      isActive = false;
    };
  }, []);

  return <RootRouteView routeDecision={routeDecision} />;
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<RootAuthRouteGate />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}
