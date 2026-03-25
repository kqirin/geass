import { Component } from 'react';

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('ui_error_boundary', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0b0b14] text-white flex items-center justify-center p-6">
          <div className="max-w-xl w-full bg-white/5 border border-white/10 rounded-3xl p-8">
            <h1 className="text-2xl font-black uppercase">Beklenmeyen UI Hatası</h1>
            <p className="text-sm text-gray-300 mt-3">Sayfayı yenileyin. Sorun devam ederse logları kontrol edin.</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

