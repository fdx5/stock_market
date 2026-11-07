# 고속도로 CCTV 국내 출발 중계

## 확인된 상태

- 기존 운영 서버는 미국 Render이며, 고속도로 ITS는 코드에서 중지되어 있었다. 운영 ITS 키는 설정되어 있다.
- 작업 PC의 외부망 국가는 KR로 확인했다. 키 없는 ITS API 요청은 연결되어 401을 반환했다. 이는 API 인증 전의 연결 검사이며 영상 재생 성공을 뜻하지 않는다.
- 국내망으로 옮겼을 때의 운영 키 인증 및 실제 영상 성공 여부는 배포 후 검증한다. 해외 IP 차단이라고 사전에 단정하지 않는다.

## 구성

- 국내 중계기는 Render 서비스의 `/api/realestate/cctv/gateway`로 WSS 연결을 먼저 맺는다. 국내 장비에 인터넷 수신 포트나 범용 프록시를 열지 않는다.
- 서버에는 Ed25519 공개키만 등록한다. 국내 중계기의 개인키는 소스·DB 밖의 보호된 파일에 두며 nonce 서명을 검증한다. 재사용된 서명이나 다른 키, 브라우저 Origin 연결은 거절한다.
- 고속도로 목록 API와 그 영상·HLS 하위 조각·키 요청만 같은 국내망을 통과한다. 기존 도시 UTIC 경로는 유지한다.
- API는 `openapi.its.go.kr:9443/cctvInfo`만 허용한다. 영상은 ITS/KTICT/도로공사 제공기관 호스트 및 정해진 포트만 허용한다. 리다이렉트마다 같은 검증과 공개 IP DNS 고정 연결을 적용한다.
- 동시 요청·응답 크기·응답 대기를 제한한다. 중계기가 없으면 해외 경로로 조용히 되돌리지 않고 연결 지연을 보고한다.
- 운영 비밀키·제공기관 영상 URL은 브라우저·로그에 전달하지 않는다. 영상 응답은 기존 불투명 토큰 경로로 제공한다. 저장 데이터·DB·스키마 변경은 없다.

## 운영 설정

- `CCTV_GATEWAY_PUBLIC_KEY`: 국내 중계기에서 생성한 공개키(Base64).
- `CCTV_HIGHWAY_GATEWAY=required`: 고속도로 요청에 국내 중계가 필요함.
- `HIGHWAY_CCTV_ENABLED=true`: 소유자가 다시 요청한 고속도로 기능 활성화.
- 기존 ITS 키 설정은 서버에서 유지한다.
- 현재 `WEB_CONCURRENCY=1` 및 Render 인스턴스 1개에서 사용한다. 연결 상태와 요청 대기는 인메모리이므로 여러 프로세스로 늘릴 때 별도 라우팅 설계가 필요하다.

중계기 의존성: `cryptography`, `websockets`, `requests`, `urllib3`.

```powershell
python backend/scripts/run_cctv_gateway.py --key-file <소스 밖의 개인키 파일> --init-key
python backend/scripts/run_cctv_gateway.py --key-file <소스 밖의 개인키 파일>
```

처음 명령은 새 파일만 생성하고 기존 개인키를 덮어쓰지 않는다. 출력되는 것은 공개키뿐이다. Windows에서는 개인키 폴더의 상속 권한을 제한한 후 생성한다.

국내 장비는 실행 중이어야 한다. PC 임시 검증과 상시 서버 운영은 구분하며, 국내 VPS/NAS로 이전할 때도 동일한 중계기를 사용할 수 있다. 기본 클라이언트는 국내망 여부를 확인하고, 연결 중단 시 제한된 지수 백오프로 재접속한다.

## 검증

- 앱 기동·DB 연결 없는 격리 테스트 44개 통과: 기존 CCTV 어댑터, 서명·재전송 거부, 활성 중계기 교체 거부, 타깃·응답 크기 제한, 국내 연결 실패 시 해외 폴백 방지, HLS 하위 요청 경로 보존, 사설 DNS 거절.
- 독립 로컬 WebSocket 서버와 실제 중계기 프로세스로 국내 ITS 서버 왕복 확인(키 없는 요청 401). 이 테스트 서버는 운영 앱이나 DB를 기동하지 않는다.
- 실제 운영 재생은 배포된 키를 서버 메모리에서 사용하여 별도로 검증해야 한다.

참고: [Render WebSockets](https://render.com/docs/websocket), [ITS CCTV API](https://www.its.go.kr/opendata/opendataList?service=cctv).
