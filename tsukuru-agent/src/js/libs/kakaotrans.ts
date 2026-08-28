import { requestJson } from '../../core/httpClient';

interface KakaoTranslationResponse {
    result?: { output?: string[][] };
}

export async function kakaoTrans(text:string, queryLanguage:string): Promise<string> {
    const response = await requestJson<KakaoTranslationResponse>(
        'https://translate.kakao.com/translator/translate.json',
        {
            method: 'POST',
            timeoutMs: 15_000,
            maxBytes: 1024 * 1024,
            maxRedirects: 0,
            headers: {
                'Origin': 'https://translate.kakao.com',
                'Referer': 'https://translate.kakao.com/',
                'User-Agent': 'Tsukuru-Agent/2.5',
                'X-Requested-With': 'XMLHttpRequest',
            },
            form: {
                queryLanguage,
                resultLanguage: 'kr',
                q: text,
            },
        },
    );
    if (response.status !== 200 || !Array.isArray(response.data.result?.output)) {
        throw new Error(`Kakao translation returned an invalid response (${response.status})`);
    }
    return decodeURIComponent(response.data.result.output.map((row) => row[0]).join('\n'));
}
