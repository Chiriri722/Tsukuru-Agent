/**
 * Headless Windows 실행 파일용 Electron 엔트리 (Phase 11).
 * 창을 만들지 않고 CLI 실행기만 호출한 뒤 종료한다.
 * 패키징된 실행 파일에서는 process.argv = [exe, ...사용자 인수]이다.
 */
import { app } from 'electron';
import { runAgent } from './run';

app.whenReady().then(async () => {
    const code = await runAgent(process.argv.slice(1));
    app.exit(code);
});
