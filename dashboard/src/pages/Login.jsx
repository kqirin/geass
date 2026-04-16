import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { getAuthLoginUrl } from '../lib/apiClient.js';

const Login = ({
  isCheckingAuth = false,
  authNotice = '',
}) => {
  const [isExiting, setIsExiting] = useState(false);

  const handleLogin = () => {
    if (isCheckingAuth) return;
    setIsExiting(true);
    setTimeout(() => {
      window.location.href = getAuthLoginUrl();
    }, 600);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0f0f1a] font-sans text-white selection:bg-cyan-500/25">
      <div className="fixed inset-0 z-0">
        <div
          className={`absolute left-[-10%] top-[-10%] h-[50%] w-[50%] rounded-full bg-cyan-500/10 blur-[150px] transition-transform duration-1000 ${
            isExiting ? 'scale-150 opacity-20' : 'scale-100 opacity-100'
          }`}
        />
        <div
          className={`absolute bottom-[-10%] right-[-10%] h-[50%] w-[50%] rounded-full bg-indigo-500/10 blur-[150px] transition-transform duration-1000 ${
            isExiting ? 'scale-150 opacity-20' : 'scale-100 opacity-100'
          }`}
        />
      </div>

      <div className="relative z-10 flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-xl rounded-[2.2rem] border border-white/10 bg-white/5 p-10 shadow-2xl shadow-black/30">
          <div className="text-4xl font-black tracking-tight text-white">GEASS</div>
          <div className="mt-2 text-sm text-white/70">
            Discord hesabınla güvenli şekilde giriş yap, paneli yönetmeye devam et.
          </div>
          {isCheckingAuth ? (
            <div className="mt-3 text-xs text-gray-400">Mevcut oturum kontrol ediliyor...</div>
          ) : null}
          {!isCheckingAuth && authNotice ? (
            <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              {authNotice}
            </div>
          ) : null}

          <button
            onClick={handleLogin}
            disabled={isCheckingAuth}
            className="mt-10 flex w-full items-center justify-center gap-3 rounded-2xl border border-cyan-400/35 bg-cyan-500/20 px-6 py-4 text-sm font-bold tracking-wide text-cyan-100 transition-all hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCheckingAuth ? 'Oturum Kontrol Ediliyor' : 'Discord ile Giriş Yap'}{' '}
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Login;
