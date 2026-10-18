/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export class EventEmitter {
    private events = new Map<string | symbol, Set<(...args: any[]) => void>>();
    on(event: string | symbol, callback: (...args: any[]) => void) {
        if (!this.events.has(event)) this.events.set(event, new Set());
        this.events.get(event)!.add(callback);
        return this;
    }
    addListener = this.on;
    off(event: string | symbol, callback: (...args: any[]) => void) { this.events.get(event)?.delete(callback); return this; }
    removeListener = this.off;
    once(event: string | symbol, callback: (...args: any[]) => void) {
        const once = (...args: any[]) => { this.off(event, once); callback(...args); };
        return this.on(event, once);
    }
    emit(event: string | symbol, ...args: any[]) {
        const listeners = [...this.events.get(event) ?? []];
        listeners.forEach(callback => callback(...args));
        return !!listeners.length;
    }
    listeners(event: string | symbol) { return [...this.events.get(event) ?? []]; }
    rawListeners = this.listeners;
    listenerCount(event: string | symbol) { return this.events.get(event)?.size ?? 0; }
    eventNames() { return [...this.events.keys()]; }
    removeAllListeners(event?: string | symbol) { if (event === undefined) this.events.clear(); else this.events.delete(event); return this; }
    setMaxListeners(_count: number) { return this; }
}

export function createPatcher() {
    const cleanups = new Set<() => void>();
    let active = true;
    function patch(kind: "before" | "after" | "instead", target: any, key: string, callback: (...args: any[]) => any) {
        if (!active || !target || typeof target[key] !== "function") return () => {};
        const descriptor = Object.getOwnPropertyDescriptor(target, key);
        const original = target[key];
        function wrapper(this: unknown, ...args: any[]) {
            if (!active) return original.apply(this, args);
            if (kind === "before") { callback(this, args); return original.apply(this, args); }
            if (kind === "instead") return callback(this, args, (...parameters: any[]) => original.apply(this, parameters));
            const result = original.apply(this, args);
            const replacement = callback(this, args, result);
            return replacement === undefined ? result : replacement;
        }
        Object.assign(wrapper, original);
        wrapper.prototype = original.prototype;
        wrapper.toString = () => original.toString();
        const assign = (value: any) => {
            if (descriptor?.set) target[key] = value;
            else Object.defineProperty(target, key, { configurable: true, enumerable: descriptor?.enumerable ?? true, writable: true, value });
        };
        assign(wrapper);
        const undo = () => {
            if (target[key] === wrapper) {
                if (descriptor?.set) target[key] = original;
                else if (descriptor) Object.defineProperty(target, key, descriptor);
                else delete target[key];
            }
            cleanups.delete(undo);
        };
        cleanups.add(undo);
        return undo;
    }
    return {
        before: (target: any, key: string, callback: (...args: any[]) => any) => patch("before", target, key, callback),
        after: (target: any, key: string, callback: (...args: any[]) => any) => patch("after", target, key, callback),
        instead: (target: any, key: string, callback: (...args: any[]) => any) => patch("instead", target, key, callback),
        unpatchAll() { for (const undo of [...cleanups].reverse()) undo(); },
        dispose() { active = false; this.unpatchAll(); }
    };
}

export const path = {
    resolve(...parts: string[]) {
        let result = "";
        for (const part of parts) {
            const normalized = part.replaceAll("\\", "/");
            result = /^(?:[a-z]:|\/)/i.test(normalized) ? normalized : `${result}/${normalized}`;
        }
        const segments: string[] = [];
        for (const part of result.split("/")) {
            if (part === "..") segments.pop();
            else if (part && part !== ".") segments.push(part);
        }
        return (result.startsWith("/") ? "/" : "") + segments.join("/");
    },
    basename: (input: string) => input.replaceAll("\\", "/").split("/").at(-1)!
};

export function findInTree(tree: any, filter: (value: any) => boolean, options: { walkable?: string[]; } = {}): any {
    const visited = new Set();
    function visit(value: any): any {
        if (value == null || visited.has(value)) return;
        visited.add(value);
        if (filter(value)) return value;
        if (typeof value !== "object") return;
        const children = Array.isArray(value) ? value : (options.walkable ?? Object.keys(value)).map(key => value[key]);
        for (const child of children) { const result = visit(child); if (result !== undefined) return result; }
    }
    return visit(tree);
}
