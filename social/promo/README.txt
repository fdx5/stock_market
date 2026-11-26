직접 쓴 홍보 글 자동 게시 (scripts/social_publish.py 프로모 대기열)

이 폴더에 .md 파일 하나 = 글 하나. 정해진 시각(KST)부터 6시간 안에 정기 게시 작업이
연결된 X·Threads·Bluesky에 올리고, 본문의 kospimap.com 링크에는 전부 자동으로
utm_source=<네트워크>&utm_medium=social&utm_campaign=promo_<campaign>-<날짜> 가 붙는다.
어드민 > 성장 관제실 > 유입 출처(UTM)에서 글별 유입을 볼 수 있다.

---
publish_at: 2026-11-27 19:00
campaign: drone_godeok
networks: threads, x, bluesky
images: social/promo/img/godeok.png
threads_topic: Investing
---
첫 줄이 제목(중복 게시 확인 키)입니다.
본문... kospimap.com/drone-explore

- networks 생략 시 전부. 길이가 넘치는 네트워크는 건너뜀(X 280·Bluesky 300·Threads 500).
- images는 PNG, 쉼표로 여러 장. threads_topic: none 이면 본문 첫 해시태그를 주제로.
