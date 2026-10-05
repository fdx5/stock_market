# Buy Me a Coffee 후원 연동

## 적용 상태

- 관리 브랜치: `feature/buymeacoffee-support-pending-review`
- 상태: 구현 및 로컬 검증 완료, 서비스 적용 보류.
- 보류 사유: Buy Me a Coffee 심사 결과가 아직 나오지 않아 결제 서비스를 운영에 적용할 수 없음.
- 심사 결과를 확인하고 운영 적용이 승인된 뒤에 기본 브랜치 병합과 배포, 실제 웹훅 수신 확인을 진행합니다.
- 웹훅과 서버 환경변수는 소유자가 등록했으며, 비밀키는 저장소에 포함하지 않습니다.

기본 결제 탭은 Buy Me a Coffee이며, 카카오페이는 두 번째 탭입니다.

Buy Me a Coffee 탭 상단에는 노란 배경·검은 글씨·흰색 커피가 있는 공식 버튼 이미지를 표시합니다. 공식 CDN의 `https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png`를 `frontend/public/img/buymeacoffee-button.png`에 저장했으며, 클릭하면 `https://buymeacoffee.com/fdx5`를 새 탭으로 엽니다. 상품별 버튼은 아래에 유지됩니다. 제공된 스크립트는 `document.writeln`을 사용하므로 React 화면에 동적으로 실행하는 대신 공식 이미지로 삽입했습니다.

| 상품 | 표시 가격 | 상품 ID | 외부 결제 링크 |
| --- | --- | --- | --- |
| 메가커피 | $2 | 583316 | https://buymeacoffee.com/fdx5/e/583316 |
| 스타벅스 커피 | $4 | 583318 | https://buymeacoffee.com/fdx5/e/583318 |
| 블루보틀 커피 | $6 | 583320 | https://buymeacoffee.com/fdx5/e/583320 |

표시 가격은 소유자가 제공한 상품 가격입니다. 실제 결제 저장에는 웹훅으로 확인된 금액과 통화를 사용합니다.

상품 카드 이미지는 사용자가 제공한 `I:\ai_root\소셜\메가커피.png`, `스타벅스.png`, `블루보틀.png`를 각각 240×240 PNG로 리사이징해 `frontend/public/img/support/`에 저장했습니다. 화면에서는 76×76으로 표시하며 원본 파일은 보존합니다.

상품 버튼은 동일한 도메인의 `/api/support/buymeacoffee/checkout/{상품 ID}`를 거쳐 해당 링크로 이동합니다. 이때 후원 방문 기록과 HttpOnly 쿠키를 생성합니다. 외부 사이트를 거쳐 돌아오므로 쿠키는 SameSite=Lax이며 HTTPS에서는 Secure를 사용합니다.

## 운영 설정

1. 각 상품의 성공 후 이동 주소를 `https://kospimap.com/support-success`로 유지합니다.
2. Buy Me a Coffee 관리자 **Integrations → New webhook**에서 Endpoint URL을 `https://kospimap.com/api/support/buymeacoffee/webhook`으로 등록합니다.
3. `extra_purchase.created`, `extra_purchase.updated`, `extra_purchase.refunded` 이벤트를 선택합니다.
4. 웹훅 상세 화면의 **Signing Secret**을 서버 환경변수 `BUYMEACOFFEE_WEBHOOK_SECRET`에 등록하고 서버를 재시작합니다. 프런트엔드 환경변수나 소스코드에 비밀키를 넣지 않습니다.
5. **Send test event**로 응답 `{"received":true,"test":true}`를 확인합니다. 테스트 알림은 결제 DB에 저장하지 않습니다.
6. 실제 상품 결제 뒤 `support_payments` 테이블에서 거래를 확인합니다. 비밀키가 없으면 웹훅은 503을 반환합니다. 상품 이동 및 감사 페이지는 사용할 수 있지만 자동 결제 저장은 설정 이후 활성화됩니다.

공식 문서: https://help.buymeacoffee.com/en/articles/15743173-how-to-setup-and-use-buy-me-a-coffee-webhooks

## 저장 및 확인

기존 후원 DB의 Turso 설정을 사용하며, 로컬 개발에서는 `backend/app/data/store/support_comments.db`를 사용합니다. 최초 연결 시 테이블 생성 및 기존 댓글의 `checkout_id` 컬럼 추가가 실행됩니다.

- `support_payments`: 서명 검증을 통과한 실제 결제. 거래 ID, 결제 ID, 상태, 금액(소수 문자열), 통화, 상품 목록, 후원자 이름·이메일, 결제 및 알림 시간을 저장합니다. 재전송은 결제 ID로 upsert하며 오래된 알림이나 늦게 도착한 성공 알림이 환불 상태를 되돌리지 않습니다. 설정한 상품이 하나 이상 포함된 주문만 저장합니다. 공개 API에서는 결제 정보나 이메일을 노출하지 않습니다.
- `support_checkouts`: 선택 상품과 방문·리다이렉트 복귀 시간. 실제 결제 여부를 의미하지 않습니다. 복귀 처리는 재방문/새로고침에 대해 멱등적입니다. 쿠키 연결은 7일까지만 유효합니다.
- `support_comments.checkout_id`: 성공 페이지에서 복귀 처리가 끝난 브라우저의 메시지를 방문 기록에 연결합니다. 기존 닉네임 20자·메시지 120자 제한과 스팸 방지 및 관리자 숨김/삭제를 그대로 사용합니다.

정적 리다이렉트 URL에는 신뢰할 수 있는 주문 식별자가 없습니다. 따라서 리다이렉트 방문이나 URL 쿼리의 `success`, 금액, 결제 ID를 근거로 결제 성공을 기록하지 않습니다. 방문 기록·한 줄 메시지와 서명된 결제를 시간/상품만으로 자동 연결하지 않습니다. 방문자는 감사 인사와 한 줄 작성 영역을 볼 수 있으며, 결제 확인은 Buy Me a Coffee 영수증을 안내합니다. 실제 결제 정보 저장은 브라우저 복귀와 관계없이 웹훅으로 수행됩니다.

관리자 DB 조회에서 운영 Turso의 `support_payments`, `support_checkouts`, `support_comments` 테이블을 확인할 수 있습니다. 대표 조회:

```sql
SELECT payment_id, transaction_id, status, amount, currency, products_json, paid_at
FROM support_payments ORDER BY paid_at DESC LIMIT 100;
```

## 검증

```powershell
backend/.venv/Scripts/python.exe -m pytest backend/tests/test_support_payments.py backend/tests/test_support_comments.py backend/tests/test_support_analytics.py
cd frontend
npm run build
```

실제 결제와 운영 웹훅 전송은 소유자 설정 및 배포 후 확인해야 합니다.

로컬 검증 결과: 관련 백엔드 테스트 39개, TypeScript 및 프로덕션 빌드 통과. 격리한 SQLite와 Edge 자동화로 320/390/760/820/1024/1440px 화면, 기본 탭 및 키보드 탭 이동, 세 상품 링크, 카카오페이 QR, 상품 선택 후 감사 페이지 복귀, 한 줄 저장 및 새로고침 유지, 쿠키 없는 직접 방문을 확인했습니다. 브라우저 실행 오류는 없었습니다. 외부 결제 화면은 테스트에서 대체했으며 실제 결제는 진행하지 않았습니다.
