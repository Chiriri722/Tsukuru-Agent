import http, { IncomingHttpHeaders } from 'http';
import https from 'https';

export type HttpMethod = 'GET' | 'POST';

export interface HttpRequestOptions {
    timeoutMs: number;
    maxBytes: number;
    method?: HttpMethod;
    query?: Record<string, string | number | boolean>;
    form?: Record<string, string | number | boolean>;
    headers?: Record<string, string>;
    allowHttpLoopback?: boolean;
    maxRedirects?: number;
    allowedRedirectHosts?: readonly string[];
    signal?: AbortSignal;
}

export interface HttpResponse<T> {
    status: number;
    headers: IncomingHttpHeaders;
    data: T;
}

function positiveInteger(value: number, field: string): void {
    if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`);
}

function isLoopback(hostname: string): boolean {
    const normalized = hostname.toLowerCase();
    return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]';
}

function targetUrl(rawUrl: string, options: HttpRequestOptions): URL {
    const target = new URL(rawUrl);
    if (target.protocol !== 'https:') {
        if (target.protocol !== 'http:' || options.allowHttpLoopback !== true || !isLoopback(target.hostname)) {
            throw new Error('HTTP requests require explicit loopback permission; remote requests must use HTTPS');
        }
    }
    for (const [key, value] of Object.entries(options.query ?? {})) {
        target.searchParams.set(key, String(value));
    }
    return target;
}

function formBody(options: HttpRequestOptions): Buffer | undefined {
    if (options.form === undefined) return undefined;
    if ((options.method ?? 'GET') !== 'POST') throw new Error('form data requires POST');
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(options.form)) form.set(key, String(value));
    return Buffer.from(form.toString(), 'utf8');
}

export function requestBuffer(rawUrl: string, options: HttpRequestOptions): Promise<HttpResponse<Buffer>> {
    positiveInteger(options.timeoutMs, 'timeoutMs');
    positiveInteger(options.maxBytes, 'maxBytes');
    const target = targetUrl(rawUrl, options);
    const body = formBody(options);
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (body) {
        headers['content-type'] ??= 'application/x-www-form-urlencoded; charset=UTF-8';
        headers['content-length'] = String(body.length);
    }
    return new Promise((resolve, reject) => {
        let settled = false;
        const finishReject = (error: Error) => {
            if (settled) return;
            settled = true;
            reject(error);
        };
        const onResponse = (response: http.IncomingMessage) => {
            const status = response.statusCode ?? 0;
            if (status >= 300 && status < 400) {
                response.resume();
                const remaining = options.maxRedirects ?? 0;
                const location = response.headers.location;
                if (remaining < 1 || typeof location !== 'string') {
                    finishReject(new Error(`HTTP redirect is not allowed (${status})`));
                    return;
                }
                const redirected = new URL(location, target);
                const allowedHosts = options.allowedRedirectHosts ?? [];
                if (!allowedHosts.some((host) => host.toLowerCase() === redirected.hostname.toLowerCase())) {
                    finishReject(new Error(`HTTP redirect host is not allowed: ${redirected.hostname}`));
                    return;
                }
                settled = true;
                resolve(requestBuffer(redirected.href, { ...options, maxRedirects: remaining - 1 }));
                return;
            }
            const declaredLength = Number(response.headers['content-length']);
            if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
                response.destroy();
                finishReject(new Error(`HTTP response size exceeds ${options.maxBytes} bytes`));
                return;
            }
            const chunks: Buffer[] = [];
            let received = 0;
            response.on('data', (chunk: Buffer | string) => {
                const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                received += value.length;
                if (received > options.maxBytes) {
                    response.destroy();
                    finishReject(new Error(`HTTP response size exceeds ${options.maxBytes} bytes`));
                    return;
                }
                chunks.push(value);
            });
            response.on('error', finishReject);
            response.on('end', () => {
                if (settled) return;
                settled = true;
                resolve({ status, headers: response.headers, data: Buffer.concat(chunks) });
            });
        };
        const request = target.protocol === 'https:'
            ? https.request(target, { method: options.method ?? 'GET', headers }, onResponse)
            : http.request(target, { method: options.method ?? 'GET', headers }, onResponse);
        request.setTimeout(options.timeoutMs, () => request.destroy(new Error(`HTTP timeout after ${options.timeoutMs}ms`)));
        request.once('error', finishReject);
        const abort = () => request.destroy(new Error('HTTP request aborted'));
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener('abort', abort, { once: true });
        request.once('close', () => options.signal?.removeEventListener('abort', abort));
        if (body) request.write(body);
        request.end();
    });
}

export async function requestData(rawUrl: string, options: HttpRequestOptions): Promise<HttpResponse<unknown>> {
    const response = await requestBuffer(rawUrl, options);
    const text = response.data.toString('utf8');
    const contentType = String(response.headers['content-type'] ?? '').toLowerCase();
    if (contentType.includes('json') || /^[\s\r\n]*[\[{]/.test(text)) {
        try {
            return { ...response, data: JSON.parse(text) };
        } catch {
            throw new Error('HTTP response contains invalid JSON');
        }
    }
    return { ...response, data: text };
}

export async function requestJson<T = unknown>(rawUrl: string, options: HttpRequestOptions): Promise<HttpResponse<T>> {
    const response = await requestBuffer(rawUrl, options);
    try {
        return { ...response, data: JSON.parse(response.data.toString('utf8')) as T };
    } catch {
        throw new Error('HTTP response contains invalid JSON');
    }
}
