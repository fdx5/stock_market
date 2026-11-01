# 룸투어 외부 공유 썸네일

- 생성: 내장 `image_gen` 도구, `imagegen` 스킬.
- 프로젝트 저장: `frontend/public/img/social/walk-roomtour-v1.png`.
- 원본: 1729×910 PNG, 1,917,237바이트. 생성 결과를 축소하거나 편집하지 않고 보존했다.
- 이미지: 공통 룸투어 안내용 실내 이미지. 특정 단지의 실제 촬영 또는 실제 렌더링 결과라고 표시하지 않는다.
- 단지명: 이미지에 고정하지 않고 서버 OG 제목과 브라우저 제목에서 해당 단지명을 표시한다.
- 예시 단지: 운영 공개 검색에서 `11680:수서동:795:강남데시앙포레`를 확인했다.
- 공개 자산 commit: `fdx5/kospimap-assets@afd164e`.
- 공개 파일: <https://fdx5.github.io/kospimap-assets/objects/03ae6fa66e85ff450424e4b3b03ed1a8c7a3575e066c7c4885ad1c9345aec879.png>.
- 카카오의 실제 채팅 발송은 수행하지 않는다. 외부에서 HTML/이미지를 인증 없이 읽을 수 있는지와 메타태그·목적지 보존을 확인한다.
- 최종 운영 배포: `636885736dc4f2777de8da59143f1df2860bbfe4`, 2026-11-01 21:58:03 KST. 세 링크의 원시 OG HTML과 이미지 GET/HEAD 200·바이트 동일성을 검증했다.
- 실제 Chrome에서도 위 강남데시앙포레 링크가 해당 단지의 원본 평형 선택 화면으로 열리고, 제목·단지명이 유지되는 것을 확인했다(1440×1000, DPR 1, 음소거). 114C 원본 분석 적용 화면까지 확인했으며 이 검사는 3D 입장 후의 검증으로 계산하지 않는다.
- 썸네일 추가 후 GitHub 전달 대상은 1,157개, 약 312.8MiB다.

## 공유 주소 단축 후속 수정

- 상세 팝업의 룸투어 주소는 `c`(공개 단지 ID)와 필요한 경우 `a`(선택한 전용면적)만 보낸다. ID 안의 단지명을 `name`으로 중복 전송하지 않고 `tour=1`, 기본 날씨·시간, 전체 지도 복귀 주소도 제거한다.
- `c`는 기존 공개 단지 ID의 UTF-8/Base64url 표현이다. 암호화나 비밀 식별자로 사용하지 않는다. 서버와 브라우저가 각각 복원하므로 별도 링크 저장 DB·세션·만료시간 없이 외부에서 열 수 있다.
- 강남데시앙포레 기본 주소는 83자, 전용 84.86㎡ 포함 주소는 91자다. 같은 단지·평형·복귀 조건의 이전 주소 287자와 비교했다. 지도 복귀 주소는 해당 브라우저의 sessionStorage에만 보관한다.
- 특정 동에 직접 진입하는 경우 그 동을 찾는 좌표 `at`와 필요한 층 `f`도 남긴다. 같은 대표 단지 ID를 사용하며 제목·이미지는 서버가 생성한다.
- 예전 긴 주소도 계속 지원한다. 새 주소 생성과 실내의 `링크 복사` 버튼은 공통 단축 함수를 사용한다.
- 독립 서버 검사 21개와 브라우저 측 주소 왕복 검사, 최종 TypeScript/운영 빌드를 통과했다. 새 브라우저에서 강남데시앙포레 단축 주소로 실제 운영 원본 API를 사용해 평형 선택·3D 실내 진입·클립보드 복사를 확인했다. 로컬 주소의 호스트/포트 차이로 클립보드는 92자였고 운영 호스트로 바꾸면 91자다(1440×1000, DPR 1, Chrome 음소거).
- 단축 주소 포함 버전 `e7bf64c5e94c29843b446b2cdcf7015ccaa274a1`은 **2026-11-01 22:08:48 KST**에 운영 배포됐다(`dep-dbjjiinb9u1s73bp993g`). 상태 API의 commit을 확인했다.
- 운영에서도 91자 주소로 강남데시앙포레 114C 원본 선택·실내 진입·클립보드 복사를 통과했고, 기존 긴 주소가 같은 단축 주소로 정리되는 것도 확인했다. 짧은 주소와 기존 주소의 외부 수집 HTML은 동일한 단지 제목과 짧은 `og:url`을 반환했다. 재확인한 3회 응답은 약 0.25초였다. 배포 직후 최초 요청에서 30초 타임아웃 1회가 있었으며 이후 확인 결과와 구분한다.
- 운영 검증 기록: [짧은 주소 검증 JSON](walk-short-share-2026-11-01.json). 실제 카카오 채팅 전송은 수행하지 않았다.

카카오는 `og:image`의 대표 이미지를 사용한다. 이미지 외부 접근과 최대 5MB 제약은 [카카오 공식 FAQ](https://developers.kakao.com/docs/ko/message-template/faq)를 확인했다. 기존 주소의 변경 내용은 [카카오 공유 미리보기 도구](https://developers.kakao.com/docs/ko/tool/common)의 캐시 초기화가 필요할 수 있다.

## 사용한 생성 프롬프트

Use case: ads-marketing. Create a polished KakaoTalk link-sharing Open Graph thumbnail for KOSPIMAP apartment room tours. Landscape 1200x630 pixels, 1.90476:1 aspect. Realistic Korean apartment living room, architectural interior photography, full opaque walls connected normally to floor and ceiling, a real doorway, sofa, low coffee table, daylight from balcony windows, comfortable clear walking aisle, high quality physically plausible materials. Composition: interior fills right two thirds, left third is a dark navy translucent gradient with cyan accents matching a neon financial terminal brand. Exact Korean headline in large extremely legible modern sans serif: "룸투어 (임장)". Small secondary line: "아파트를 3D로 둘러보세요". Small brand wordmark "KOSPIMAP". Keep all text safely inset, no apartment name in image because reused across apartment links; actual apartment name goes in dynamic share title. Tasteful small cyan navigation locator icon. No people, no watermarks, no collage, no floorplan cutaway, no frame-only walls, no isolated columns, no impossible structure. This is a generic promotional interior image, do not imply it depicts a named apartment.
