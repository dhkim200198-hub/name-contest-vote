# 배포 가이드

투표 기록은 JSON 한 덩어리로 저장됩니다. 무료 호스팅은 대부분 "일정 시간 놀면 잠들고
깨어날 때 파일이 초기화"되므로, 무료로 하려면 **기록을 Upstash(무료 Redis)에 두고**
호스팅은 잠들어도 되게 만듭니다.

---

## 방법 A — Render(무료) + Upstash Redis(무료)  ★ 추천, 카드 등록 불필요

### 1) Upstash 무료 데이터베이스 만들기

1. https://upstash.com → **Sign up** (GitHub / Google 계정, 카드 없음).
2. **Create Database** → 이름 아무거나, Region 은 `AWS / ap-northeast-1 (Tokyo)` 정도 → Create.
3. 데이터베이스 상세 화면 아래 **REST API** 섹션에서 두 값을 복사해 둡니다:
   - `UPSTASH_REDIS_REST_URL` (예: `https://xxxx.upstash.io`)
   - `UPSTASH_REDIS_REST_TOKEN` (긴 문자열)

### 2) Render 에 배포

1. https://render.com → **GitHub 계정으로 로그인** (무료, 카드 없음).
2. 저장소 접근 허용 화면에서 `dhkim200198-hub/name-contest-vote` 선택.
3. 대시보드 → **New +** → **Blueprint** → `name-contest-vote` 선택 → Render 가
   `render.yaml` 을 읽음 → **Apply**. (플랜은 Free 그대로 두면 됩니다.)
4. 서비스로 들어가 **Environment** 탭에서 값 3개를 입력하고 저장 (자동 재배포):
   | Key | Value |
   | --- | --- |
   | `ADMIN_PASSWORD` | 관리자 비밀번호 |
   | `UPSTASH_REDIS_REST_URL` | 1)에서 복사한 URL |
   | `UPSTASH_REDIS_REST_TOKEN` | 1)에서 복사한 TOKEN |
5. 상단 `https://name-contest-vote-xxxx.onrender.com` 이 완성된 주소입니다.
   - 투표: `그 주소/`
   - 관리자: `그 주소/admin`
   - 결과: `그 주소/results`

### 참고

- 로그(Logs 탭)에 `[store] 저장소: Upstash Redis ...` 가 보이면 정상입니다.
  `[store] 저장소: /opt/...` 로 보이면 Upstash 값이 잘못 들어간 것이니 다시 확인하세요.
- 무료 Render 는 15분간 접속이 없으면 잠듭니다. 다음 접속 시 30~60초 깨어나는 시간이
  걸리지만, 기록은 Upstash 에 있으므로 **표는 사라지지 않습니다.**
- Upstash 무료 한도(하루 만 건 명령)는 이 투표 규모에서 전혀 문제되지 않습니다
  (투표 1건 = 쓰기 1회, 화면 조회는 서버 메모리에서 처리되어 Upstash 를 안 씀).
- 공모전이 끝나면 Render 서비스와 Upstash DB 를 삭제하면 됩니다. 둘 다 무료라 안 지워도 요금은 없습니다.

---

## 방법 B — Render 유료(Starter) 한 방

Upstash 없이 Render 영구 디스크만으로. 월 $7 (+디스크 약 $0.25). `render.yaml` 에서
`plan: free` 를 `plan: starter` 로 바꾸고 아래 `disk` 블록을 추가:

```yaml
    plan: starter
    disk:
      name: vote-data
      mountPath: /var/data
      sizeGB: 1
    envVars:
      - key: DATA_DIR
        value: /var/data
```

---

## 방법 C — Fly.io (무료 한도, 가입 시 카드 필요)

```bash
iwr https://fly.io/install.ps1 -useb | iex        # flyctl 설치 (PowerShell)
fly auth login
cd "C:\agent 2\name-contest-vote"
fly launch --no-deploy --name name-contest-vote --region nrt
fly volumes create vote_data --size 1 --region nrt
# fly.toml 에 추가:
#   [mounts]
#     source = "vote_data"
#     destination = "/data"
#   [env]
#     DATA_DIR = "/data"
fly secrets set ADMIN_PASSWORD=원하는비밀번호
fly deploy
```

주소: `https://name-contest-vote.fly.dev`

---

## 방법 D — 사내 서버 / VPS 직접 실행

```bash
git clone https://github.com/dhkim200198-hub/name-contest-vote.git
cd name-contest-vote
npm install
ADMIN_PASSWORD=원하는비밀번호 DATA_DIR=/srv/vote-data node server.js
# 실서비스는 pm2 등으로 상시 실행 + 앞단에 Nginx(HTTPS) 권장
```

---

## 공통

- `ADMIN_PASSWORD` 를 반드시 설정 (미설정 시 `admin1234` 로 동작하며 로그에 경고).
- HTTPS 는 호스팅(또는 앞단 Nginx)이 처리한다고 가정합니다.
- 백업: 관리자 `결과 · 집계` 화면 캡처, 또는 Upstash 콘솔에서 `name-contest-vote:db` 키 값 복사.
