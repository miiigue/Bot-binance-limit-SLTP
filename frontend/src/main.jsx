import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("React Error Caught by ErrorBoundary:", error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '32px', background: '#0f172a', color: '#f87171', fontFamily: 'monospace', minHeight: '100vh' }}>
          <h2 style={{ color: '#ef4444', fontSize: '22px', fontWeight: 'bold' }}>⚠️ Error en la Aplicación React</h2>
          <p style={{ color: '#fca5a5', marginTop: '12px', fontSize: '15px' }}>{this.state.error?.toString()}</p>
          <pre style={{ background: '#1e293b', padding: '16px', borderRadius: '8px', overflowX: 'auto', color: '#e2e8f0', marginTop: '16px', fontSize: '13px' }}>
            {this.state.error?.stack}
          </pre>
          <div style={{ marginTop: '20px', display: 'flex', gap: '12px' }}>
            <button 
              onClick={() => { localStorage.clear(); sessionStorage.clear(); window.location.reload(); }} 
              style={{ padding: '10px 20px', background: '#dc2626', color: '#fff', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
            >
              🧹 Limpiar Caché y Recargar
            </button>
            <button 
              onClick={() => window.location.reload()} 
              style={{ padding: '10px 20px', background: '#3b82f6', color: '#fff', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
            >
              🔄 Recargar Página
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)