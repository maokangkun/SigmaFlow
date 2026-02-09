import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { ThemeProvider } from './components/theme-provider';
import Sidebar from './components/Sidebar';
import TracesPage from './components/TracesPage';
import TraceDetailPage from './components/TraceDetailPage';
import ApiKeysPage from './components/ApiKeysPage';
import CostsPage from './components/CostsPage';
import { ModelPricesPage } from './components/ModelPricesPage';
import SetupPage from './components/SetupPage';
import LoginPage from './components/LoginPage';
import InitialSetupPage from './components/InitialSetupPage';
import ProtectedRoute from './components/ProtectedRoute';
import { authApi } from './api';

function SetupChecker({ children }: { children: React.ReactNode }) {
  const [setupCompleted, setSetupCompleted] = useState<boolean | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const checkSetup = async () => {
      try {
        const status = await authApi.getSetupStatus();
        setSetupCompleted(status.completed);
        if (!status.completed) {
          navigate('/initial-setup', { replace: true });
        }
      } catch (error) {
        console.error('Error checking setup status:', error);
        setSetupCompleted(true);
      }
    };
    checkSetup();
  }, [navigate]);

  if (setupCompleted === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!setupCompleted) {
    return null;
  }

  return <>{children}</>;
}

function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <ThemeProvider defaultTheme="dark" storageKey="openai-tracing-theme">
      <BrowserRouter basename="/admin">
        <Routes>
          <Route path="/initial-setup" element={<InitialSetupPage />} />
          <Route
            path="/*"
            element={
              <SetupChecker>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route
                    path="/*"
                    element={
                      <ProtectedRoute>
                        <div className="h-screen bg-background">
                          <Sidebar
                            collapsed={sidebarCollapsed}
                            onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
                          />
                          <div
                            className={`h-screen transition-all duration-300 ${
                              sidebarCollapsed ? 'ml-16' : 'ml-64'
                            }`}
                          >
                            <Routes>
                              <Route path="/" element={<Navigate to="/traces" replace />} />
                              <Route path="/traces" element={<TracesPage />} />
                              <Route path="/trace/:id" element={<TraceDetailPage />} />
                              <Route path="/costs" element={<CostsPage />} />
                              <Route path="/model-prices" element={<ModelPricesPage />} />
                              <Route path="/api-keys" element={<ApiKeysPage />} />
                              <Route path="/setup" element={<SetupPage />} />
                            </Routes>
                          </div>
                        </div>
                      </ProtectedRoute>
                    }
                  />
                </Routes>
              </SetupChecker>
            }
          />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
