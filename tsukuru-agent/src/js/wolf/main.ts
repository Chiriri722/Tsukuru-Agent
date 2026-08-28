/**
 * GUI Wolf IPC adapter. 실제 로직은 WolfService에 있다.
 * 기존 동작 보존: 성공 시 'alert2', 실패 시 'alert', 항상 worked().
 * 의도적 수정 2가지(notes.md 위험·주의 사항 참조):
 * - 기존 wolf_ext는 catch에서 worked()를 호출하지 않아 오류 시 UI가 잠긴 채로 남았음 → 항상 해제
 * - 기존 wolf_apply는 try/catch가 없어 예외 시 무응답이었음 → 오류 alert 추가
 */
import { worked } from "../../../main";
import { OperationError } from "../../core/types";
import { onValidated } from "../../electron/ipcRegistration";
import { publicErrorMessage } from "../../core/publicError";
import { guiOperationCancellation } from "../../electron/operationCancellation";
import { cancelGuiOperation, runGuiOperation } from "../../electron/guiWorkerService";

function alertError(err: unknown) {
    const message = publicErrorMessage(err);
    mwindow.webContents.send('alert', { icon: 'error', message });
}

export async function wolfInit() {
    onValidated('wolf_ext', async (ev, arg: { folder: string, config: { [key: string]: boolean } }) => {
        let operation;
        try {
            operation = guiOperationCancellation.begin(() => cancelGuiOperation());
            await runGuiOperation({
                operation: 'wolf-extract',
                payload: arg,
                settings: { ...globalThis.settings },
                oPath: globalThis.oPath,
            });
            mwindow.webContents.send('alert2');
        }
        catch (err) {
            alertError(err);
        } finally {
            if (operation) guiOperationCancellation.finish(operation.id);
        }
        worked();
    });
    onValidated('wolf_apply', async (ev, arg: { folder: string, config: { [key: string]: boolean } }) => {
        let operation;
        try {
            operation = guiOperationCancellation.begin(() => cancelGuiOperation());
            await runGuiOperation({
                operation: 'wolf-apply',
                payload: arg,
                settings: { ...globalThis.settings },
                oPath: globalThis.oPath,
            });
            mwindow.webContents.send('alert2');
        }
        catch (err) {
            alertError(err);
        } finally {
            if (operation) guiOperationCancellation.finish(operation.id);
        }
        worked();
    });
}
