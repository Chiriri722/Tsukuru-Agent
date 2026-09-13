# Validation guide
애플리케이션 디렉터리에서 Node.js 22/24 및 npm 10/11을 사용한다.

```powershell
node node_modules/typescript/bin/tsc -p tsconfig.build.json
node --test --test-concurrency=1 test/integration/rpg-translation-validation.test.js
npm run verify
npm run test:order
npm run benchmark:check
npm run test:electron
```

각 단계의 RED/GREEN과 정상 대조군은 verification.md에 기록한다.
최종 suite 후 private corpus 복사본에서 현재 .build/app/src/cli/main.js run --request를 사용한다.
이전 안내서의 verify scripts는 현재 경로로 별도 조정하고 원본 스크립트/게임/번역을 덮어쓰지 않는다.
결과는 구조, 번역 토큰, 언어 잔존, 의미 감수, 게임 실행 상태로 구분한다.
