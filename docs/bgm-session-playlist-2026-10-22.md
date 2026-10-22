# 음악 목록 및 세션 재생 순서 개편

2026-10-22 사용자 지정 12개 YouTube 영상으로 사이트의 음악 목록을 통합했다.
기존 입구 5곡과 내부 12곡의 별도 목록을 런타임 코드에서 제거했다. 기존 정적
이퀄라이저 파일은 음원이 아니며 어떤 재생 목록에서도 참조하지 않는다.

## 재생 방식

- 탭 세션의 첫 진입에서 12개 영상을 한 번 섞는다. 공개 영상 ID의 순서와 현재
  위치만 sessionStorage에 보관한다. 회원 정보나 외부 토큰은 저장하지 않는다.
- 입구, 내부 페이지, 플로팅 음악 플레이어가 같은 YouTube iframe과 상태를 사용한다.
- 끝난 곡 다음에는 정해진 다음 곡을 재생한다. 한 바퀴를 마치면 같은 순서를 반복한다.
- 이전/다음 곡 이동, 전원 끄기/켜기, 일시정지로 순서를 다시 섞지 않는다.
- 새로고침 후에도 순서와 곡 위치를 복원한다. 새로고침 후 소리는 사용자가 켜며,
  재생 시간까지 복원하거나 브라우저의 자동재생 제한을 우회하지 않는다.
- 재생 불가 영상은 같은 순서의 다음 영상으로 넘어가며, 연속 12회 실패하면 멈춘다.
- 저장소 접근이 차단된 환경에서는 현재 페이지의 메모리에서 순서를 유지한다.

## 지정 영상

| 영상 ID | 표시 곡명 |
|---|---|
| -lbbHQbZNKg | Lights · Sappheiros |
| pF2tXC1pXNo | Chill · sakura Hz |
| DUWRbl3eVi0 | Dawn · Sappheiros |
| 6WQjgHuUDWU | Lost Within · A Himitsu |
| vP4jqXzphvc | Way Home · Tokyo Music Walker |
| uYjUI_zeeJk | White Petals · Keys of Moon |
| TrNDRrDXQdo | Nocturne · Nomyn |
| 8PqN8kexaT0 | Breath of the Galaxy |
| TMXlHacZSh0 | Interstellar Drift |
| 7dn32JVyB6s | Map in Grey |
| DzYp5uqixz0 | Embrace · Sappheiros |
| DHNZeIy4kjs | Lost Within · A Himitsu |

Lost Within은 사용자가 지정한 서로 다른 두 영상 ID를 모두 유지했다.
영상 제목·게시 채널·임베드 가능 상태를 YouTube 공개 메타데이터로 확인했다.
이 확인을 별도의 저작권 보증으로 간주하지 않는다. 음악 크레딧 페이지에 곡명,
작곡가, 원본 영상 링크와 설명에서 확인한 CC 라이선스 링크를 표기했다.

## 이퀄라이저와 UI

모든 곡에 실제 음원으로 분석한 14대역·20fps envelope를 연결했다. 기존 지정곡
3개의 데이터는 재사용하고 9개의 데이터를 추가했다. 브라우저는 YouTube의 재생
시간에 맞춰 데이터를 읽는다. 12개 막대인 내부 플레이어도 고음역을 버리지 않고
14개 원본 대역 전체를 재분배한다. 원음 파일은 배포에 포함하지 않는다.

운영 코드의 canvas 이퀄라이저와 드론 비행 시 프레임 제한을 유지했다. 축소 동작
설정은 기존처럼 존중한다. 전원 아이콘과 ON/OFF 문구의 중앙 정렬도 함께 반영했다.

## 검증

- `node --test frontend/tests/bgm-session.test.mjs`: 14개 통과.
- 전체 `npm run build`: TypeScript와 Vite 빌드 통과.
- 독립된 메모리 모의 플레이어로 2회 연속 순환, 재시작, 세션 복원, 전원/일시정지,
  입구/내부 플레이어 공유, 실패 처리, 백그라운드 복귀 및 envelope 연결을 검사했다.
- 연결 가능한 브라우저가 없어 실제 UI·청취·Chrome 비행 성능은 검증하지 못했다.

DB·저장 데이터 삭제나 마이그레이션은 실행하지 않는다. 최신 origin/main에서
별도 작업 폴더를 만들어 음악 변경분만 배포한다. 사용자 지시 범위의 정상 배포와
기존 서버 시작 작업만 수행한다. 배포 증거는 작업 폴더의 `qa/`에 보관한다.
