/**
 * GUI 'apply' IPC 핸들러(legacy adapter).
 * 실제 로직은 RpgMakerService.apply에 있다.
 * 기존 동작 보존: 성공 시 'alert2'+'loading 0', 실패 시 'alert', 항상 'worked 0'.
 * - Extract/.extracteddata 부재 등 알려진 오류는 평문 메시지(기존과 동일한 안남문)
 * - 예기치 못한 오류는 stack과 절대 경로를 제거한 사용자 메시지
 */
import { publicErrorMessage } from '../../core/publicError';
import { guiOperationCancellation } from '../../electron/operationCancellation';
import { cancelGuiOperation, runGuiOperation } from '../../electron/guiWorkerService';

function legacyApplyErrorMessage(error: unknown): string {
    const message = publicErrorMessage(error);
    return message === 'RPG Extract 디렉터리를 찾을 수 없습니다'
        ? 'Extract 폼더가 존재하지 않습니다'
        : message;
}

export const apply = async (ev, arg) => {
    let operation;
    try {
        operation = guiOperationCancellation.begin(() => cancelGuiOperation());
        const dir = Buffer.from(arg.dir, 'base64').toString('utf8');
        await runGuiOperation({
            operation: 'rpg-apply',
            payload: {
                dir,
                instantapply: arg.instantapply,
                autoline: arg.autoline,
                isComment: arg.isComment,
                useYaml: arg.useYaml,
            },
            settings: { ...globalThis.settings },
            oPath: globalThis.oPath,
        });
        globalThis.mwindow.webContents.send('alert2');
        globalThis.mwindow.webContents.send('loading', 0);
    } catch (err) {
        const message = legacyApplyErrorMessage(err);
        globalThis.mwindow.webContents.send('alert', { icon: 'error', message });
    } finally {
        if (operation) guiOperationCancellation.finish(operation.id);
    }
    globalThis.mwindow.webContents.send('worked', 0);
};
