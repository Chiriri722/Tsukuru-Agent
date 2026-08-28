import { dialog } from 'electron';
import { onValidated } from '../../electron/ipcRegistration';
import { changeRpgFontSize, installRpgFont } from './fontService';

function sendAlert(txt:string){
    globalThis.mwindow.webContents.send('alert', txt);
}

function ErrorAlert(txt:string){
    globalThis.mwindow.webContents.send('alert', {icon: 'error',  message: txt});
}

function worked(){
  globalThis.mwindow.webContents.send('worked', 0);
  globalThis.mwindow.webContents.send('loading', 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function initFontIPC(){
  onValidated('selFont', async (ev, dir) => {
    try {
      const f = await dialog.showOpenDialog({
        "title": '폰트 선택',
        "properties": ["openFile"],
        "filters":[{
          "name": "폰트",
          "extensions": ["ttf", "otf"]
        }],
      })
      if(f.canceled || f.filePaths.length === 0){
        ErrorAlert('취소되었습니다')
        return
      }
      installRpgFont(dir, f.filePaths[0])
      sendAlert('완료되었습니다')
    } catch (error) {
      ErrorAlert(errorMessage(error))
    } finally {
      worked()
    }
})

onValidated('changeFontSize', async (ev, arg) => {
    try {
      changeRpgFontSize(arg[0], arg[1])
      sendAlert('완료되었습니다')
    } catch (error) {
      ErrorAlert(errorMessage(error))
    } finally {
      worked()
    }
});
}
