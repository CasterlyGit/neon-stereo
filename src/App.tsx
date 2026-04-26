import { useEffect, useState } from 'react';
import { ConnectScreen } from './components/ConnectScreen';
import { Dashboard } from './components/Dashboard';
import { NeonFrame } from './components/NeonFrame';

type AuthKind = 'logged-in' | 'logged-out' | 'unknown';

export function App(): JSX.Element {
  const [auth, setAuth] = useState<AuthKind>('unknown');

  useEffect(() => {
    let mounted = true;
    void window.neonStereo.auth.getStatus().then((s) => {
      if (mounted) setAuth(s.kind);
    });
    const off = window.neonStereo.auth.onAuthChange((e) => setAuth(e.kind));
    return () => {
      mounted = false;
      off();
    };
  }, []);

  return (
    <NeonFrame>
      {auth === 'logged-in' ? <Dashboard /> : <ConnectScreen />}
    </NeonFrame>
  );
}
