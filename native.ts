/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export function readClipboardImagePngBase64(): string {
    try {
        const electron = require("electron");
        const clipboard = electron?.clipboard;
        if (!clipboard?.readImage) return "";

        const image = clipboard.readImage();
        if (!image || image.isEmpty?.()) return "";

        const pngBuffer = image.toPNG?.();
        if (!pngBuffer || !pngBuffer.length) return "";

        return Buffer.from(pngBuffer).toString("base64");
    } catch {
        return "";
    }
}

export async function fetchJson(_, url: string): Promise<any | null> {
    try {
        if (!url) return null;

        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Accept": "application/json"
            }
        });

        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    }
}

// Fetches binary from Node context (no renderer CSP) and returns base64.
// Uses https module directly so Electron main-process fetch quirks don't apply.
export function fetchBinaryAsBase64(_, url: string): Promise<string> {
    const doRequest = (requestUrl: string, redirectsLeft: number): Promise<string> => new Promise(resolve => {
        try {
            const https = require("https");
            const parsed = new URL(requestUrl);
            const options = {
                hostname: parsed.hostname,
                path: parsed.pathname + parsed.search,
                method: "GET",
                headers: { "Referer": "https://jisho.org", "User-Agent": "Mozilla/5.0" }
            };
            const req = https.request(options, (res: any) => {
                if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && redirectsLeft > 0) {
                    res.resume();
                    resolve(doRequest(res.headers.location, redirectsLeft - 1));
                    return;
                }
                if (res.statusCode < 200 || res.statusCode >= 300) { resolve(""); return; }
                const chunks: Buffer[] = [];
                res.on("data", (chunk: Buffer) => chunks.push(chunk));
                res.on("end", () => {
                    const buf = Buffer.concat(chunks);
                    // JPod101 returns a ~289-byte silence MP3 for unknown words; reject it.
                    resolve(buf.length > 500 ? buf.toString("base64") : "");
                });
                res.on("error", () => resolve(""));
            });
            req.on("error", () => resolve(""));
            req.end();
        } catch {
            resolve("");
        }
    });
    return doRequest(url, 3);
}
