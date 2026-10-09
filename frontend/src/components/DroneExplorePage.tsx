import { lazy, Suspense, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useBroadsheet } from '../desk2/shell';
import { useL } from '../desk2/lib';
import { useLanguage } from '../i18n/LanguageContext';
import { useDocumentTitle } from '../useDocumentTitle';
import LoadingState from './LoadingState';
import { navigate } from '../router';
import './drone-explore.css';

const ComplexHologram = lazy(() => import('./ComplexHologram'));
const START_COMPLEX = '11290:길음동:1288:래미안길음센터피스';

export default function DroneExplorePage() {
  useBroadsheet();
  const L = useL(), { lang } = useLanguage();
  useDocumentTitle(L('드론 탐험 | K-Stock Hub', 'Drone explorer | K-Stock Hub'));
  const complexId = new URLSearchParams(location.search).get('complex') || START_COMPLEX;
  const close = useCallback(() => navigate('/realestate-map'), []);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    // The flight handles Escape first (a selected building card closes before the flight).
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    document.addEventListener('keydown', escape);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', escape); };
  }, [close]);
  return createPortal(
    <main className="d2 drone-explore-page" lang={lang} aria-label={L('드론 탐험 전체화면', 'Full-screen drone explorer')}>
      <Suspense fallback={<LoadingState text="드론 탐험을 준비하는 중…" />}>
        <ComplexHologram key={complexId} complexId={complexId} wide autoDrone onDroneExit={close} caption={L('도시 탐험 · 드론 비행', 'City explorer · drone flight')} />
      </Suspense>
      <button ref={closeButton} type="button" className="drone-explore-close" onClick={close}
        aria-label={L('드론 탐험 닫기', 'Close drone explorer')} title={L('닫고 부동산 지도로 이동 (Esc)', 'Close and return to the property map (Esc)')}>×</button>
    </main>, document.body,
  );
}
