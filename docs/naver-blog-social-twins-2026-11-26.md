# 네이버 블로그 — SNS 자동 게시와 같은 시각에 블로그 글 게시 (2026-11-26)

## 무엇을 하나
SNS(Buffer → X·Threads·Bluesky)로 나가는 모든 자동 판마다, 같은 시각에 네이버 블로그(kospi-predictor)에
긴 글을 게시한다. 장마감 브리핑 7건은 앞으로 '오늘의 브리핑' 카테고리로 들어간다.

| KST | 판(edition) | 블로그 카테고리 | 장 규칙 |
|---|---|---|---|
| 00:50 | us_movers_open 나스닥100 개장 직후 급등락 | 급등/급락의 이유(9) | 미국 세션(KST-12h) |
| 06:50 | us_movers_close 나스닥100 마감 급등락 | 9 | 미국 세션 |
| 07:00 | nasdaq_close 나스닥100 마감 히트맵 | 코스피/코스닥/나스닥(7) | 전날 미국 세션 |
| 07:15 | morning 오늘의 핫이슈 아침판 | 오늘의 핫이슈(6) | 매일 |
| 08:00 | world_morning 세계 증시 성적표 | 글로벌 증시(10) | 매일 |
| 09:30 | movers_open 국내 장 초반 급등락 | 9 | KRX |
| 12:00 | midday 코스피·코스닥 장중 히트맵 | 7 | KRX |
| 12:40 | movers_noon 국내 점심 급등락 | 9 | KRX |
| 16:00 | close 코스피·코스닥 장마감 히트맵 | 7 | KRX |
| 16:15 | movers_close 국내 장 마감 급등락 | 9 | KRX |
| 16:20~ | 장마감 브리핑 7건 | 오늘의 브리핑(8) | KRX |
| 17:00 | world_evening 세계 증시 성적표 | 10 | 매일 |
| 21:10 | us_movers_pre 나스닥100 프리마켓 급등락 | 9 | 미국 세션 |
| 22:15 | evening 오늘의 핫이슈 밤판 | 6 | 매일 |

## 어디서 도나
- **서버와 PC가 같은 원장으로 함께 게시** (1bbe674): Render(`naver_social_publisher.start_server_scheduler`, 2분마다, 브리핑 16:20~23:00 포함)와
  PC 작업 스케줄러 `KStockHub-Naver-Blog-Worker`(2분마다 `backend/scripts/naver_blog_worker.py`) 중 먼저 쓰는 쪽이 게시, `claim()`이 중복을 막는다.
  서버가 거부당하면(`no privilege`) 1시간 쉰다. `NAVER_PUBLISH_ON_SERVER=0`이면 서버 게시 끔.
- **2026-11-26 09:31 확인: Render(미국 오리건 IP) 글쓰기는 여전히 `no privilege`로 거부.** PC 작업을 끈 시험에서 서버가 거부당했고,
  PC를 다시 켜자 09:34에 게시됨. PC가 꺼져도 게시되려면 네이버 보안설정(IP 보안·해외 로그인 차단) 확인 또는 한국 IP 실행 서버가 필요.
- 실행 위치: `H:\ai_work\naver-worker` (origin/main 클론, 할 일이 없을 때 1시간마다 `git pull --ff-only` → main에 푸시한 개선이 자동 반영).
  `.env`는 I:\ai_root\stock_market\backend\.env 복사본(Turso, 세션 키 유도용).
- 판마다 SNS 시각부터 창(3~6시간) 안에서 데이터가 준비되면 게시. 데이터가 아직이면 재시도 횟수를 쓰지 않고 다음 틱에 재시도,
  창이 닫히면 `skipped`. 게시 간격 45~100초, 브리핑과 같은 리스(`naver_blog_publish_lock`)를 공유해 동시에 두 글을 쓰지 않는다.
- 카테고리: 발행 레이어에서 선택 + RabbitWrite 요청의 `populationParams.populationMeta.categoryId`를 직접 지정. 게시 후 공개 목록 API로 실제 카테고리를 확인해 원장(`category_seen`)에 남긴다.

## 저장(모두 추가형)
`naver_social_posts`(판별 원장), `naver_social_runs`(시도 로그), `naver_social_perf`(게시물·일자별 측정 1행, insert-only),
`naver_blog_worker`(PC 발행기 하트비트).

## 성과 측정과 튜닝
- 모든 링크: `utm_source=naver_blog&utm_medium=referral&utm_campaign=nb_<edition>-<YYYYMMDD>` (브리핑은 `nb_brief_<market>-<날짜>`).
- 매일 23:30 PC가 `naver_social_perf.collect()`: 게시물별 사이트 유입(page_views), 공감·댓글, 게시 다음 날 네이버 블로그 검색 순위(제목 단어로 검색).
- `naver_social_tuning`: 제목 형태 A/B/C × 태그 전략 tight(10)/wide(15) = 6개 변형. 보상 = 유입 + 검색 10위 안이면 3점.
  변형마다 2건씩 먼저 시험한 뒤 가장 좋은 변형 75%, 나머지 탐색 25%.
- 기준선: 도입 전 30일(10-27~11-26) 블로그 경유 11세션 ≈ 하루 0.37. 목표 100배 ≈ 하루 37세션.

## 운영 화면
어드민 → 운영·배치 타임테이블의 '네이버 블로그' 줄: 판별 게시 상태·카테고리·글자 수·변형, PC 발행기 응답(25분 넘게 없으면 실패).
아래 '네이버 블로그 성과' 패널: 하루 평균 유입과 목표 대비 배수, 게시물별 유입·검색순위·공감, 변형별 성과, 발행 기록.
API: `/api/admin/naver-blog/social?days=7`, `/api/admin/ops/timeline`.

## 수동 실행
```
cd H:\ai_work\naver-worker\backend
python scripts/naver_blog_worker.py --status
python scripts/naver_blog_worker.py --test morning --date 2026-11-26 --dry-run   # 편집기 주입까지만
python scripts/naver_blog_worker.py --test close movers_close                    # 오늘 날짜로 즉시 게시(원장이 중복 방지)
python scripts/naver_blog_worker.py --perf
```
로그: `backend/logs/naver_blog_worker.log` (쿠키·토큰은 남기지 않음).

## 위험
- 서버 쓰기가 막혀 있는 동안은 PC가 꺼져 있으면 게시가 늦어지거나 창이 닫혀 건너뛴다(작업은 WakeToRun, 부팅 후 즉시 실행). 어드민의 'PC 블로그 발행기 응답'으로 감시.
- 하루 20건 안팎의 자동 글은 네이버 저품질 판정 위험이 있다. 글마다 내용이 다르고(데이터·이유 본문), 이모지·상투어를 쓰지 않으며, 간격을 둔다.
