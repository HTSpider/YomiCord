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
