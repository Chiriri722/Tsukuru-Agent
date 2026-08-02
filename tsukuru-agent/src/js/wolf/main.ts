/**
 * GUI Wolf IPC adapter. 실제 로직은 WolfService에 있다.
 * 기존 동작 보존: 성공 시 'alert2', 실패 시 'alert', 항상 worked().
 * 의도적 수정 2가지(notes.md 위험·주의 사항 참조):
 * - 기존 wolf_ext는 catch에서 worked()를 호출하지 않아 오류 시 UI가 잠긴 채로 남았음 → 항상 해제
 * - 기존 wolf_apply는 try/catch가 없어 예외 시 무응답이었음 → 오류 alert 추가
 */
import { ipcMain } from "electron";
import { worked } from "../../../main";
import { WolfService } from "./WolfService";
import { buildGuiContext } from "../../electron/guiContext";
import { OperationError } from "../../core/types";

function alertError(err: unknown) {
    const message = (err instanceof OperationError) ? err.message : JSON.stringify(err, Object.getOwnPropertyNames(err));
    mwindow.webContents.send('alert', { icon: 'error', message });
}

export async function wolfInit() {
    ipcMain.on('wolf_ext', async (ev, arg: { folder: string, config: { [key: string]: boolean } }) => {
        try {
            const service = new WolfService(buildGuiContext());
            await service.extract(arg);
            mwindow.webContents.send('alert2');
        }
        catch (err) {
            alertError(err);
        }
        worked();
    });
    ipcMain.on('wolf_apply', async (ev, arg: { folder: string, config: { [key: string]: boolean } }) => {
        try {
            const service = new WolfService(buildGuiContext());
            await service.apply(arg);
            mwindow.webContents.send('alert2');
        }
        catch (err) {
            alertError(err);
        }
        worked();
    });
}
