import { useState, useEffect } from 'react';
import { useSFX } from '../hooks/useSFX';

interface SplashScreenProps {
  onComplete: () => void;
}

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const [phase, setPhase] = useState<'letters' | 'hold' | 'fade'>('letters');
  const sfx = useSFX();

  useEffect(() => {
    // Trigger splash sound after a short delay
    const s0 = setTimeout(() => sfx.splash(), 100);
    const t1 = setTimeout(() => setPhase('hold'), 1200);
    const t2 = setTimeout(() => setPhase('fade'), 2400);
    const t3 = setTimeout(onComplete, 3200);
    return () => { clearTimeout(s0); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onComplete]);

  const letters = 'SATIE'.split('');

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: '#0a0a0a',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      opacity: phase === 'fade' ? 0 : 1,
      transition: 'opacity 0.8s ease-out',
    }}>
      <div style={{
        display: 'flex',
        gap: '0.04em',
        userSelect: 'none',
      }}>
        {letters.map((letter, i) => (
          <span
            key={i}
            style={{
              fontSize: 'clamp(60px, 15vw, 200px)',
              fontWeight: 300,
              fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
              color: '#f4f3ee',
              letterSpacing: '0.08em',
              opacity: phase === 'letters' ? 0 : 1,
              transform: phase === 'letters' ? 'translateY(40px)' : 'translateY(0)',
              transition: `opacity 0.6s ease-out ${i * 0.12}s, transform 0.6s ease-out ${i * 0.12}s`,
            }}
          >
            {letter}
          </span>
        ))}
      </div>

      {/* Subtle line underneath */}
      <div style={{
        position: 'absolute',
        bottom: '38%',
        left: '50%',
        transform: 'translateX(-50%)',
        width: phase === 'letters' ? 0 : 'clamp(80px, 20vw, 280px)',
        height: '1.5px',
        background: '#f4f3ee',
        opacity: phase === 'fade' ? 0 : 0.2,
        transition: `width 0.8s ease-out 0.7s, opacity 0.6s ease-out`,
      }} />
    </div>
  );
}
