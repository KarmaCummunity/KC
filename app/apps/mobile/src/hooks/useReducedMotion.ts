import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduced(v);
    }, () => {
      // Platform query failed — keep the default (motion allowed).
    });
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (v: boolean) => { if (mounted) setReduced(v); },
    );
    return () => { mounted = false; sub.remove(); };
  }, []);

  return reduced;
}
