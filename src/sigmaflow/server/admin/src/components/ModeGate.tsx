import { useEffect, useState } from 'react';
import { authApi } from '../api';

/**
 * 模式引导门: 单用户模式免登录直进; 多用户模式复用 science 会话
 * (未登录跳 science 登录页, 登录后返回)。
 */
export function ModeGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'open'>('loading');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mode = await authApi.getMode();
        if (!alive) return;
        if (mode.mode === 'multi' && !mode.authenticated) {
          // 去 science 登录: 同前缀下的 science 应用(/admin -> /science)
          const base = /^.*\/admin(?=\/|$)/.exec(window.location.pathname)?.[0] || '/admin';
          const science = base.replace(/\/admin$/, '/science');
          window.location.href = science + '/#/auth';
          return;
        }
        setState('open');
      } catch {
        // 探测失败(如服务重启中): 显示提示并允许重试, 不再弹回注册页
        if (alive) setState('open');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (state !== 'open') {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">正在验证访问权限…</p>
      </div>
    );
  }
  return <>{children}</>;
}
