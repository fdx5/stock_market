import { lazy, Suspense } from 'react';
import Masthead from '../desk2/Masthead';
import { useBroadsheet } from '../desk2/shell';
import { useL } from '../desk2/lib';
import { useLanguage } from '../i18n/LanguageContext';
import { useDocumentTitle } from '../useDocumentTitle';
import LoadingState from './LoadingState';
import './drone-explore.css';

const ComplexHologram = lazy(() => import('./ComplexHologram'));
const START_COMPLEX = '11290:길음동:1288:래미안길음센터피스';

export default function DroneExplorePage() {
  useBroadsheet();
  const L = useL(), { lang } = useLanguage();
  useDocumentTitle(L('드론 탐험 | K-Stock Hub', 'Drone explorer | K-Stock Hub'));
  const complexId = new URLSearchParams(location.search).get('complex') || START_COMPLEX;
  return (
    <div className="d2 drone-explore-page" lang={lang}>
      <Masthead rail={false} onPrint={() => window.print()} />
      <main className="drone-explore-main">
        <div className="drone-explore-intro">
          <h2>{L('드론 탐험', 'Drone explorer')}</h2>
          <p>{L('하늘에서 도시를 둘러보고, 건물을 눌러 정보와 평균 시세를 확인하세요.', 'Explore the city from above. Tap a building for its information and average price.')}</p>
        </div>
        <Suspense fallback={<LoadingState text="드론 탐험을 준비하는 중…" />}>
          <ComplexHologram key={complexId} complexId={complexId} autoDrone caption={L('도시 탐험 · 드론 비행', 'City explorer · drone flight')} />
        </Suspense>
      </main>
    </div>
  );
}
