/**
 * GUI 'apply' IPC 핸들러(legacy adapter).
 * 실제 로직은 RpgMakerService.apply에 있다.
 * 기존 동작 보존: 성공 시 'alert2'+'loading 0', 실패 시 'alert', 항상 'worked 0'.
 * - Extract/.extracteddata 부재 등 알려진 오류는 평문 메시지(기존과 동일한 안남문)
 * - 예기치 못한 오류는 JSON 직렬화(기존 catch-all과 동일)
 */
import { RpgMakerService } from './RpgMakerService';
import { buildGuiContext } from '../../electron/guiContext';
import { OperationError } from '../../core/types';

export const apply = async (ev, arg) => {
    try {
        const dir = Buffer.from(arg.dir, 'base64').toString('utf8');
        const service = new RpgMakerService(buildGuiContext());
        await service.apply({
            dir,
            instantapply: arg.instantapply,
            autoline: arg.autoline,
            isComment: arg.isComment,
            useYaml: arg.useYaml,
        });
        globalThis.mwindow.webContents.send('alert2');
        globalThis.mwindow.webContents.send('loading', 0);
    } catch (err) {
        const message = (err instanceof OperationError) ? err.message : JSON.stringify(err, Object.getOwnPropertyNames(err));
        globalThis.mwindow.webContents.send('alert', { icon: 'error', message });
    }
    globalThis.mwindow.webContents.send('worked', 0);
};
