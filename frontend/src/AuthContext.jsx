import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('bot_auth_token'));
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('bot_auth_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [isLoading, setIsLoading] = useState(true);
  const [needsInitialAdmin, setNeedsInitialAdmin] = useState(false);

  // Comprobar si el sistema requiere crear el Super Administrador inicial
  const checkSetupStatus = useCallback(async () => {
    try {
      const resp = await fetch('/api/auth/setup_status');
      if (resp.ok) {
        const data = await resp.json();
        setNeedsInitialAdmin(Boolean(data.needs_initial_admin));
        return data;
      }
    } catch (err) {
      console.warn('No se pudo verificar el estado de setup inicial:', err);
    }
    return null;
  }, []);

  // Verificar validez del token al cargar la app
  useEffect(() => {
    let isMounted = true;

    async function initAuth() {
      setIsLoading(true);
      await checkSetupStatus();

      const savedToken = localStorage.getItem('bot_auth_token');
      if (savedToken) {
        try {
          const resp = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${savedToken}` }
          });
          if (resp.ok) {
            const data = await resp.json();
            if (isMounted && data.user) {
              setUser(data.user);
              localStorage.setItem('bot_auth_user', JSON.stringify(data.user));
            }
          } else {
            // Token inválido o expirado
            if (isMounted) {
              setToken(null);
              setUser(null);
              localStorage.removeItem('bot_auth_token');
              localStorage.removeItem('bot_auth_user');
            }
          }
        } catch (err) {
          console.warn('Error al verificar sesión existente:', err);
        }
      }
      if (isMounted) {
        setIsLoading(false);
      }
    }

    initAuth();
    return () => { isMounted = false; };
  }, [checkSetupStatus]);

  // Iniciar Sesión
  const login = async (identifier, password) => {
    try {
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password })
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.message || 'Error al iniciar sesión.');
      }

      setToken(data.token);
      setUser(data.user);
      localStorage.setItem('bot_auth_token', data.token);
      localStorage.setItem('bot_auth_user', JSON.stringify(data.user));
      setNeedsInitialAdmin(false);
      return data;
    } catch (err) {
      throw err;
    }
  };

  // Registro de Usuario (Primer usuario = Admin, siguientes = Inversionista pendiente)
  const register = async (username, email, password, investmentAmount = 0) => {
    try {
      const resp = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username, 
          email, 
          password,
          investment_amount: parseFloat(investmentAmount) || 0
        })
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.message || 'Error en el registro.');
      }

      // Si fue el primer usuario, se auto-loguea como Super Admin
      if (data.token && data.user) {
        setToken(data.token);
        setUser(data.user);
        localStorage.setItem('bot_auth_token', data.token);
        localStorage.setItem('bot_auth_user', JSON.stringify(data.user));
        setNeedsInitialAdmin(false);
      }

      return data;
    } catch (err) {
      throw err;
    }
  };

  // Cerrar Sesión
  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('bot_auth_token');
    localStorage.removeItem('bot_auth_user');
  };

  // authFetch: Realiza llamadas fetch inyectando el token JWT y capturando 401
  const authFetch = useCallback(async (url, options = {}) => {
    const currentToken = localStorage.getItem('bot_auth_token');
    const headers = {
      ...(options.headers || {}),
      ...(currentToken ? { 'Authorization': `Bearer ${currentToken}` } : {})
    };

    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
      // Sesión expirada
      logout();
    }
    return response;
  }, []);

  const value = {
    token,
    user,
    role: user?.role || null,
    isAdmin: user?.role === 'admin',
    isInvestor: user?.role === 'investor',
    isAuthenticated: Boolean(token && user),
    isLoading,
    needsInitialAdmin,
    login,
    register,
    logout,
    authFetch,
    checkSetupStatus
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe ser usado dentro de un AuthProvider');
  }
  return context;
}
