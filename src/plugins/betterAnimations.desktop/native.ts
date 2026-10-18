/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DATA_DIR } from "@main/utils/constants";
import { IpcMainInvokeEvent, shell } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join, relative, resolve } from "path";

const parent = join(DATA_DIR, "animation-packs");
const root = join(parent, "BetterAnimations");

function safePath(input: string): string {
    const target = resolve(root, input);
    const rel = relative(root, target);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Animation files must stay inside the BetterAnimations folder");
    if (existsSync(root)) {
        const canonicalRoot = realpathSync(root);
        let ancestor = target;
        while (!existsSync(ancestor)) { const next = dirname(ancestor); if (next === ancestor) break; ancestor = next; }
        const canonical = realpathSync(ancestor);
        const actualRelative = relative(canonicalRoot, canonical);
        if (actualRelative.startsWith("..") || isAbsolute(actualRelative)) throw new Error("Animation paths cannot follow links outside the pack folder");
    }
    return target;
}

export function syncRoot(_event: IpcMainInvokeEvent): string {
    mkdirSync(root, { recursive: true });
    return parent.replaceAll("\\", "/");
}

export function syncFs(_event: IpcMainInvokeEvent, operation: string, input: string, value?: string): unknown {
    const target = safePath(input);
    switch (operation) {
        case "exists": return existsSync(target);
        case "mkdir": return mkdirSync(target, { recursive: true });
        case "read": return readFileSync(target, "utf8");
        case "write": {
            if (target === root || !target.endsWith(".json")) throw new Error("Only animation JSON files may be written");
            writeFileSync(target, value ?? "", "utf8");
            return;
        }
        case "unlink": {
            if (target === root || !target.endsWith(".json")) throw new Error("Only animation JSON files may be deleted");
            return unlinkSync(target);
        }
        case "rename": {
            const destination = safePath(value ?? "");
            if (target === root || destination === root || !target.endsWith(".json") || !destination.endsWith(".json")) throw new Error("Only animation JSON files may be renamed");
            return renameSync(target, destination);
        }
        case "list": return readdirSync(target);
        case "stat": {
            const stat = statSync(target);
            return { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, birthtimeMs: stat.birthtimeMs, file: stat.isFile(), directory: stat.isDirectory() };
        }
        case "snapshot": return Object.fromEntries(readdirSync(target).filter(name => name.endsWith(".json")).map(name => [name, statSync(join(target, name)).mtimeMs]));
        default: throw new Error("Unsupported animation file operation");
    }
}

export function reveal(_event: IpcMainInvokeEvent, input: string, folder: boolean): Promise<string> | void {
    const target = safePath(input);
    if (folder) return shell.openPath(target);
    shell.showItemInFolder(target);
}

export async function fetchResource(_event: IpcMainInvokeEvent, input: string) {
    const url = new URL(input);
    if (url.protocol !== "https:" || !["gist.githubusercontent.com", "raw.githubusercontent.com", "github.com"].includes(url.hostname)) throw new Error("Unsupported animation catalog URL");
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    return { status: response.status, statusText: response.statusText, text: await response.text(), headers: Object.fromEntries(response.headers) };
}
