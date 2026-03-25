import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

const Login = () => {
  const [isExiting, setIsExiting] = useState(false);

  const handleLogin = () => {
    setIsExiting(true);
    setTimeout(() => {
      window.location.href = `${API_BASE}/api/auth/login`;
    }, 600);
  };

  return (
    <div className="min-h-screen bg-[#0f0f1a] text-white selection:bg-purple-500/30 overflow-hidden font-sans relative">
      <div className="fixed inset-0 z-0">
        <div
          className={`absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-purple-600/10 blur-[150px] rounded-full transition-transform duration-1000 ${
            isExiting ? 'scale-150 opacity-20' : 'scale-100 opacity-100'
          }`}
        />
        <div
          className={`absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-600/10 blur-[150px] rounded-full transition-transform duration-1000 ${
            isExiting ? 'scale-150 opacity-20' : 'scale-100 opacity-100'
          }`}
        />
      </div>

      <div className="relative z-10 min-h-screen flex items-center justify-center px-6">
        <div className="w-full max-w-xl bg-white/5 border border-white/10 rounded-[2.5rem] p-10 shadow-2xl">
          <div className="text-4xl font-black italic uppercase tracking-widest">GEASS</div>
          <div className="text-gray-400 mt-3">Discord ile giris yap ve paneli yonet.</div>

          <button
            onClick={handleLogin}
            className="mt-10 w-full px-6 py-4 rounded-2xl bg-purple-600/30 border border-purple-500/30 hover:bg-purple-600/40 transition-all font-black uppercase tracking-widest flex items-center justify-center gap-3"
          >
            GIRIS YAP <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Login;
