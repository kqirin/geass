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
        <div className="flex min-h-screen items-center justify-center bg-[#0b0b14] p-6 text-white">
          <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/5 p-8">
            <h1 className="text-2xl font-black">Beklenmeyen UI Hatası</h1>
            <p className="mt-3 text-sm text-gray-300">
              Sayfayı yenileyin. Sorun devam ederse logları kontrol edin.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
