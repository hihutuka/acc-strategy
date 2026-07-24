import {StrictMode, Component, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// 何らかの想定外エラーで描画が落ちても、白画面のまま固まらず再読み込みを促すためのガード
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; message: string; stack: string }> {
  declare props: { children: ReactNode };
  state: { hasError: boolean; message: string; stack: string } = { hasError: false, message: '', stack: '' };
  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error && error.stack ? error.stack : '',
    };
  }
  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    console.error('App crashed:', error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', background: '#020617', color: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'sans-serif' }}>
          <div style={{ textAlign: 'center', maxWidth: '90vw' }}>
            <p style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '18px', color: '#f87171' }}>予期しないエラーが発生しました</p>
            <p style={{ fontSize: '14px', color: '#94a3b8', marginBottom: '16px' }}>入力値をご確認のうえ、再読み込みしてください。</p>
            <button
              onClick={() => window.location.reload()}
              style={{ background: '#dc2626', color: 'white', padding: '8px 16px', borderRadius: '8px', border: 'none', fontWeight: 'bold', marginBottom: '16px' }}
            >
              再読み込み
            </button>
            <pre style={{ textAlign: 'left', fontSize: '11px', color: '#fca5a5', background: '#0f172a', padding: '12px', borderRadius: '8px', overflow: 'auto', maxHeight: '40vh', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {this.state.message}
              {this.state.stack ? `\n\n${this.state.stack}` : ''}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);