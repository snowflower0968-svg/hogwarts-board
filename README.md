# 호그와트 익명 게시판 — 간단 배포 가이드 (Firebase + Netlify)

이 버전은 서버 코드(Cloud Functions) 없이, 브라우저가 Firebase 데이터베이스에
직접 접속하는 훨씬 단순한 구조입니다. 그래서 터미널에서 CLI로 배포하는
과정이 필요 없습니다 — Firebase 콘솔에서 클릭 몇 번, 그리고 Netlify에
폴더 드래그 앤 드롭만 하면 됩니다.

**참고**: 이 버전은 포인트 조작 방지 같은 서버 측 보안 검증을 하지
않습니다. 즉, 아주 작정하고 브라우저 개발자도구를 조작하는 사람이 있다면
자기 포인트를 바꿀 수도 있습니다. 친구들끼리 쓰는 게시판이라는 전제로,
배포 난이도를 낮추기 위한 선택입니다.

## 1. Firebase 콘솔에서 할 일 (이미 대부분 끝났다면 건너뛰어도 됨)

이미 아래 항목들을 완료했다면 2번으로 바로 넘어가세요:

- [x] Firebase 프로젝트 생성
- [x] Authentication → 이메일/비밀번호 로그인 방법 켜기
- [x] Firestore Database 생성 (프로덕션 모드, 서울 리전 권장)
- [x] 웹 앱 등록 후 `firebaseConfig` 값 확보

**Blaze 요금제는 이제 필요 없습니다** — Cloud Functions를 안 쓰기 때문에
무료 Spark 요금제로도 충분합니다. (이미 Blaze로 전환했다면 그대로 둬도
되고, 청구되는 금액은 없습니다.)

## 2. 보안 규칙 붙여넣기 (CLI 필요 없음!)

1. Firebase 콘솔 → 프로젝트 → 왼쪽 메뉴 **Firestore Database**
2. 상단 탭에서 **"규칙"** 클릭
3. 지금 보이는 규칙 내용을 전부 지우고, 이 프로젝트의 `firestore.rules`
   파일 내용을 통째로 복사해서 붙여넣기
4. **"게시"** 버튼 클릭

이게 끝입니다. 터미널 필요 없습니다.

## 3. 프론트엔드 빌드

터미널에서 이 프로젝트 폴더로 이동한 뒤:

```bash
npm install
```

`.env.example`을 `.env`로 복사하고 (Windows는 `copy`, Mac/Linux는 `cp`),
Firebase 콘솔에서 받은 `firebaseConfig` 값 6개를 채워넣습니다:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

그리고 빌드:

```bash
npm run build
```

`dist`라는 폴더가 새로 생깁니다.

## 4. Netlify에 배포 (드래그 앤 드롭)

1. https://app.netlify.com 접속 → 로그인
2. 이미 만들어둔 사이트가 있다면 그 사이트로 들어가서 **"Deploys"** 탭
3. 방금 만든 **`dist` 폴더**를 그 화면에 끌어다 놓기
4. 새 사이트로 처음 만드는 거라면, 대시보드에서 바로 `dist` 폴더를
   끌어다 놓으면 자동으로 새 사이트가 생성됩니다

몇 초~1분 뒤 `https://아무이름.netlify.app` 주소가 뜨거나 갱신됩니다.

## 5. 첫 관리자 계정 만들기

1. 배포된 사이트에서 아무 아이디로 회원가입
   ("관리자 승인 대기중" 뜨는 게 정상)
2. Firebase 콘솔 → Firestore Database → **데이터** 탭 → `users` 컬렉션
3. 방금 가입한 문서 찾아서 클릭
4. `approved` 필드를 `true`로, `isAdmin` 필드를 `true`로 수정
5. 그 아이디로 다시 로그인 → 관리자 페이지 확인

## 색인(index) 에러가 뜨면

화면에서 "The query requires an index" 같은 에러가 뜨면:
1. 브라우저 개발자도구(F12) → Console 탭에서 에러 메시지 확인
2. 메시지 안에 파란 링크가 있습니다 — 클릭
3. Firebase 콘솔에서 "색인 만들기" 버튼만 누르면 됩니다
4. 1~2분 기다린 뒤 새로고침

## 알아두면 좋은 점

- 도박 배율(x10~x-10)과 확률, 댓글 5개당 1포인트, 글 1개당 2포인트,
  채팅 유효시간 1시간 같은 규칙은 `src/lib/api.js` 안에 있습니다.
- 아이디는 내부적으로 `아이디@hogwarts.local` 형태의 가짜 이메일로
  다뤄집니다. 화면에는 항상 진짜 아이디만 보입니다.
