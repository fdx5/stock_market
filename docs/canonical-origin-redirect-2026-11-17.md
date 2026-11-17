# Render 원본 주소의 정식 도메인 이동

`kospi-predictor.onrender.com`을 브라우저로 방문하면 HTML의 첫 스크립트에서
`https://kospimap.com`의 같은 경로로 이동한다. 쿼리와 해시를 보존하고 원본
포트는 제거한다. `location.replace`로 뒤로 가기 시 원본을 재방문하지 않는다.

정식 도메인이 Render 원본을 프록시하므로 서버의 Host만 검사하는 일괄 301은
접속 루프를 만든 이력이 있다(`28b449c2`). 따라서 브라우저에 표시된 정확한
원본 호스트만 검사한다. 정식 도메인에서는 동일 HTML을 받아도 이동하지 않는다.
API, 정적 파일, 헬스체크 응답은 변경하지 않는다. 이 이동은 JavaScript가 켜진
브라우저에 적용되며 HTTP 응답 자체를 301로 바꾸지는 않는다. 서버 301로
전환하려면 먼저 공개 프록시의 원본 요청 식별을 명시적으로 구성해야 한다.

검증 명령:

```powershell
python frontend/scripts/test-canonical-origin-redirect.py
python frontend/scripts/test-canonical-origin-redirect.py --html frontend/dist/index.html
python frontend/scripts/test-canonical-origin-redirect.py --live
```

로컬 검사는 API를 호출하지 않고 두 도메인에 동일 HTML을 제공해 프록시와 직접
방문을 재현한다. 운영 검사는 두 도메인의 HTML 탐색만 허용하고 하위 리소스와
API 요청은 차단한다. 기존 DB와 저장 데이터는 검사 대상이 아니다.
