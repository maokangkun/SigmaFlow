import {
  FileText,
  Key,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  BarChart3,
  Settings,
  LogOut,
  DollarSign,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme-provider';
import { useAuth } from '../hooks/useAuth';
import { cn } from '@/lib/utils';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function Sidebar({ collapsed, onToggleCollapse }: SidebarProps) {
  const { theme, setTheme } = useTheme();
  const { logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const isTracesActive =
    location.pathname === '/traces' || location.pathname.startsWith('/trace/');
  const isCostsActive = location.pathname === '/costs';
  const isModelPricesActive = location.pathname === '/model-prices';
  const isApiKeysActive = location.pathname === '/api-keys';
  const isSetupActive = location.pathname === '/setup';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div
      className={cn(
        'fixed left-0 top-0 bg-card border-r border-border h-screen flex flex-col transition-all duration-300 z-50',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      <div
        className={cn(
          'flex items-center',
          collapsed ? 'p-4 justify-center' : 'p-6'
        )}
      >
        {!collapsed && (
          <h1 className="text-xl font-semibold text-foreground">
            SigmaFlow Tracing
          </h1>
        )}
        {collapsed && (
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">
              OT
            </span>
          </div>
        )}
      </div>

      <nav className="flex-1 p-3 space-y-2">
        <Button
          variant={isTracesActive ? 'default' : 'ghost'}
          onClick={() => navigate('/traces')}
          className={cn(
            'w-full justify-start gap-3',
            collapsed && 'justify-center px-2'
          )}
          title={collapsed ? 'Traces' : undefined}
        >
          <FileText className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Traces</span>}
        </Button>
        <Button
          variant={isCostsActive ? 'default' : 'ghost'}
          onClick={() => navigate('/costs')}
          className={cn(
            'w-full justify-start gap-3',
            collapsed && 'justify-center px-2'
          )}
          title={collapsed ? 'Costs & Usage' : undefined}
        >
          <BarChart3 className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Costs & Usage</span>}
        </Button>
        <Button
          variant={isModelPricesActive ? 'default' : 'ghost'}
          onClick={() => navigate('/model-prices')}
          className={cn(
            'w-full justify-start gap-3',
            collapsed && 'justify-center px-2'
          )}
          title={collapsed ? 'Model Prices' : undefined}
        >
          <DollarSign className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Model Prices</span>}
        </Button>
        <Button
          variant={isApiKeysActive ? 'default' : 'ghost'}
          onClick={() => navigate('/api-keys')}
          className={cn(
            'w-full justify-start gap-3',
            collapsed && 'justify-center px-2'
          )}
          title={collapsed ? 'API Keys' : undefined}
        >
          <Key className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>API Keys</span>}
        </Button>
        <Button
          variant={isSetupActive ? 'default' : 'ghost'}
          onClick={() => navigate('/setup')}
          className={cn(
            'w-full justify-start gap-3',
            collapsed && 'justify-center px-2'
          )}
          title={collapsed ? 'Setup' : undefined}
        >
          <Settings className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Setup</span>}
        </Button>
      </nav>

      <div className="p-3 border-t border-border space-y-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className={cn('w-full justify-center gap-2', collapsed && 'px-2')}
          title={
            theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
          }
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
          {!collapsed && (
            <span>{theme === 'dark' ? 'Light' : 'Dark'} Mode</span>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleLogout}
          className={cn('w-full justify-center gap-2', collapsed && 'px-2')}
          title="Logout"
        >
          <LogOut className="w-4 h-4" />
          {!collapsed && <span>Logout</span>}
        </Button>
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleCollapse}
        className="absolute -right-3 top-6 h-6 w-6 rounded-full border border-border bg-card shadow-md hover:bg-accent z-10"
      >
        {collapsed ? (
          <ChevronRight className="w-3 h-3" />
        ) : (
          <ChevronLeft className="w-3 h-3" />
        )}
      </Button>
    </div>
  );
}
