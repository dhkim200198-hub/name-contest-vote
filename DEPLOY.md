# 배포 가이드

투표 기록은 `DATA_DIR/db.json` 파일 하나에 저장됩니다. 따라서 **재시작해도 파일이 유지되는(영구 디스크) 환경**이어야 표가 안 사라집니다.

---

## 방법 A — Render (유료 Starter, 가장 간단)

월 $7 (Starter) + 디스크 1GB(약 $0.25). 공모전이 끝나면 서비스를 삭제하면 과금이 멈춥니다.
100만원 상금 공모전 기준으로는 며칠치 몇 천 원 수준입니다.

1. https://render.com 접속 → **GitHub 계정으로 로그인** (무료 가입, 카드 없이 시작).
2. 처음이면 GitHub 연동 화면에서 `dhkim200198-hub/name-contest-vote` 저장소 접근을 허용.
3. 대시보드에서 **New +** → **Blueprint**.
4. `name-contest-vote` 저장소 선택 → Render가 `render.yaml` 을 자동으로 읽음 → **Apply**.
5. 배포가 시작되면 서비스 이름을 눌러 들어가서 **Environment** 탭 →
   `ADMIN_PASSWORD` 값에 **관리자 비밀번호**를 입력하고 저장 (자동 재배포됨).
6. 상단의 `https://name-contest-vote-xxxx.onrender.com` 주소가 완성된 사이트입니다.
   - 투표: `그 주소/`
   - 관리자: `그 주소/admin`
   - 결과: `그 주소/results`

> Blueprint 화면에서 플랜이 Free 로 보이면 Starter 로 바꿔야 디스크가 생성됩니다.
> 디스크 없이 Free 로 올리면 사이트는 뜨지만 재시작 시 투표가 초기화됩니다.

### 끝난 뒤

Render 대시보드 → 서비스 → Settings → 맨 아래 **Delete Service**. 그 전에 관리자
`결과 · 집계` 화면을 캡처하거나, 필요하면 Shell 로 `db.json` 을 내려받아 보관하세요.

---

## 방법 B — Fly.io (무료 한도 내, 설정 몇 단계 더)

Fly.io 무료 허용량으로 작은 앱 + 작은 볼륨을 커버할 수 있습니다. 카드 등록을 요구할 수 있습니다.

```bash
# 1. flyctl 설치 (PowerShell)
iwr https://fly.io/install.ps1 -useb | iex

# 2. 로그인 (브라우저 열림)
fly auth login

# 3. 이 폴더에서 앱 생성 (배포는 잠시 미룸)
cd "C:\agent 2\name-contest-vote"
fly launch --no-deploy --name name-contest-vote --region nrt

# 4. 투표 기록용 볼륨 1GB 생성
fly volumes create vote_data --size 1 --region nrt

# 5. fly.toml 에 아래를 추가
#   [mounts]
#     source = "vote_data"
#     destination = "/data"
#   [env]
#     DATA_DIR = "/data"

# 6. 관리자 비밀번호를 시크릿으로 등록
fly secrets set ADMIN_PASSWORD=원하는비밀번호

# 7. 배포
fly deploy
```

배포 후 `https://name-contest-vote.fly.dev` 가 주소입니다.

---

## 방법 C — 사내 서버 / VPS 직접 실행

```bash
git clone https://github.com/dhkim200198-hub/name-contest-vote.git
cd name-contest-vote
npm install
ADMIN_PASSWORD=원하는비밀번호 DATA_DIR=/srv/vote-data node server.js
# 실서비스는 pm2 등으로 상시 실행 + 앞단에 Nginx(HTTPS) 권장
```

---

## 공통 확인

- `ADMIN_PASSWORD` 를 반드시 설정했는지 (미설정 시 `admin1234` 로 동작하며 로그에 경고).
- HTTPS 는 호스팅(또는 앞단 Nginx)이 처리한다고 가정합니다.
- 백업이 필요하면 `DATA_DIR/db.json` 파일 하나만 복사하면 됩니다.
