/**
 * THIRD-PARTY-NOTICES 생성 스크립트 (Phase 11, GPLv3 의존성 고지).
 * package.json의 직접 dependencies 각각의 LICENSE 파일을 모아
 * THIRD-PARTY-NOTICES 파일을 만든다. 실행: node scripts/generate-notices.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const LICENSE_NAMES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'COPYING', 'COPYING.md'];

const header = `THIRD-PARTY-NOTICES
===================

Tsukuru agent (Tsukuru Extractor Headless CLI 개조본)
이 애플리케이션은 다음 오픈 소스 패키지를 사용한다. 각 라이선스 전문은
배포 패키지의 node_modules 내 각 디렉터리에서도 확인할 수 있다.

`;

let out = header;
const missing = [];
for (const name of Object.keys(pkg.dependencies ?? {}).sort()) {
    const dir = path.join(ROOT, 'node_modules', name);
    let lic = null;
    for (const cand of LICENSE_NAMES) {
        if (fs.existsSync(path.join(dir, cand))) {
            lic = fs.readFileSync(path.join(dir, cand), 'utf8');
            break;
        }
    }
    let version = '?';
    try {
        version = require(path.join(dir, 'package.json')).version ?? '?';
    } catch { /* ignore */ }
    out += `\n${'='.repeat(70)}\n${name}@${version}\n${'-'.repeat(70)}\n`;
    if (lic) {
        out += lic.trim() + '\n';
    } else {
        out += '(LICENSE 파일을 찾지 못했습니다 — 패키지 저장소를 참조하세요)\n';
        missing.push(name);
    }
}

fs.writeFileSync(path.join(ROOT, 'THIRD-PARTY-NOTICES'), out, 'utf8');
console.log(`THIRD-PARTY-NOTICES written: ${Object.keys(pkg.dependencies ?? {}).length} packages`);
if (missing.length > 0) {
    console.log('LICENSE 누락:', missing.join(', '));
}
