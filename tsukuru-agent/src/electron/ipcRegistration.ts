import { app, ipcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { assertTrustedSender, IpcPolicyError, validateIpcRequest } from './ipcPolicy';
import { RendererInvokeChannel, RendererToMainChannel } from './ipcTypes';

export interface StructuredIpcError {
  code: string;
  message: string;
}

export type StructuredIpcResponse =
  | { ok: true; value: unknown }
  | { ok: false; error: StructuredIpcError };

type ValidatedHandler = (event: IpcMainEvent, payload: any) => unknown | Promise<unknown>;

function publicError(error: unknown): StructuredIpcError {
  if (error instanceof IpcPolicyError) {
    return { code: error.code, message: error.message };
  }
  return { code: 'E_IPC_INTERNAL', message: 'The requested GUI operation failed.' };
}

function sendError(event: IpcMainEvent, error: unknown): void {
  const payload = publicError(error);
  if (!event.sender.isDestroyed()) event.sender.send('ipc:error', payload);
}

export function onValidated(
  channel: RendererToMainChannel,
  handler: ValidatedHandler,
  trustedRoots?: string | readonly string[],
): void {
  ipcMain.on(channel, (event, rawPayload) => {
    let payload: unknown;
    try {
      assertTrustedSender(event, trustedRoots ?? app.getAppPath());
      payload = validateIpcRequest(channel, rawPayload);
    } catch (error) {
      sendError(event, error);
      return;
    }

    try {
      Promise.resolve(handler(event, payload)).catch((error) => sendError(event, error));
    } catch (error) {
      sendError(event, error);
    }
  });
}

export function handleValidated(
  channel: RendererInvokeChannel,
  handler: (event: IpcMainInvokeEvent, payload: any) => unknown | Promise<unknown>,
  trustedRoots?: string | readonly string[],
): void {
  ipcMain.handle(channel, async (event, rawPayload): Promise<StructuredIpcResponse> => {
    let payload: unknown;
    try {
      assertTrustedSender(event, trustedRoots ?? app.getAppPath());
      payload = validateIpcRequest(channel, rawPayload);
    } catch (error) {
      return { ok: false, error: publicError(error) };
    }
    try {
      return { ok: true, value: await handler(event, payload) };
    } catch (error) {
      return { ok: false, error: publicError(error) };
    }
  });
}
