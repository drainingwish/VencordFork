/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { cache, moduleListeners, wreq } from "@webpack";
import { React } from "@webpack/common";

import { declarations } from "./capture";

type Filter = (value: any, module?: any, id?: string) => boolean;
interface Options {
    filter?: Filter;
    searchExports?: boolean;
    raw?: boolean;
    declarationFilter?: Filter;
    map?: Record<string, Filter>;
    mapDeclarations?: boolean;
}
const sourceFilter = Symbol("factory source filter");
const views = new WeakMap<Function, Function>();
const safe = (filter: Filter, value: any, module?: any, id?: string) => {
    try {
        if (typeof value === "function") {
            if (!views.has(value)) views.set(value, new Proxy(value, { get(target, key, receiver) {
                if ((key === "type" || key === "render") && !(key in target)) return target;
                if (key === "toString") return target.toString.bind(target);
                return Reflect.get(target, key, receiver);
            } }));
            return !!filter(views.get(value), module, id);
        }
        return !!filter(value, module, id);
    } catch { return false; }
};
const values = (object: any): any[] => {
    if (!object || !["object", "function"].includes(typeof object)) return [];
    return Object.keys(object).flatMap(key => { try { return [object[key]]; } catch { return []; } });
};
const cssAliases = new WeakMap<object, object>();
function exposeCss(value: any): any {
    if (!value || typeof value !== "object") return value;
    if (cssAliases.has(value)) return cssAliases.get(value);
    const entries = Object.entries(value);
    if (!entries.length || !entries.every(([, item]) => typeof item === "string")) return value;
    const aliases: Record<string, unknown> = { ...value };
    for (const [, item] of entries) for (const token of (item as string).split(" ")) {
        const match = token.match(/^(.+?)_[a-zA-Z0-9_-]{6,}$/);
        if (match) aliases[match[1]] ??= item;
    }
    cssAliases.set(value, aliases);
    return aliases;
}
export function createWebpack() {
    let disposed = false;
    const cleanups: (() => void)[] = [];
    const componentViews = new WeakMap<Function, any>();
    const pending = new Set<{ filter: Filter; options: Options; resolve: (value: any) => void; }>();
    const Filters = {
        byKeys: (...keys: string[]): Filter => value => value != null && keys.every(key => key in Object(value)),
        byPrototypeKeys: (...keys: string[]): Filter => value => value?.prototype && keys.every(key => key in value.prototype),
        byDisplayName: (name: string): Filter => value => value?.displayName === name,
        byStoreName: (name: string): Filter => value => value?.getName?.() === name || value?.constructor?.displayName === name,
        byStrings: (...strings: (string | RegExp)[]): Filter => value => typeof value === "function" && strings.every(text => typeof text === "string" ? String(value).includes(text) : text.test(String(value))),
        bySource: (...strings: string[]): Filter => Object.assign((_value: any, _module: any, id?: string) => strings.every(text => String(wreq.m[id!]).includes(text)), { [sourceFilter]: true })
    };
    function prepare(value: any, filter: Filter, id: string): any {
        if (typeof value !== "function") return value;
        try { if (filter(value, cache[id], id)) return value; } catch { /* A memo/forwardRef shape is required. */ }
        const source = String(filter);
        if (!/\.(?:type|render)\b/.test(source)) return value;
        if (componentViews.has(value)) return componentViews.get(value);
        const wrapped = /\.type/.test(source)
            ? React.memo(/\.render/.test(source) ? React.forwardRef(value) : value)
            : React.forwardRef(value);
        componentViews.set(value, wrapped);
        // Keep Discord's imports and internal lexical references pointing at the same mutable React component.
        for (const object of new Set([cache[id]?.exports, declarations.get(id)])) {
            if (!object || typeof object !== "object") continue;
            for (const key of Object.keys(object)) {
                let original: any;
                try { original = object[key]; } catch { continue; }
                if (original !== value) continue;
                const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
                if (descriptor.set) {
                    object[key] = wrapped;
                    cleanups.push(() => { if (object[key] === wrapped) object[key] = value; });
                } else if (descriptor.configurable) {
                    Object.defineProperty(object, key, { configurable: true, enumerable: descriptor.enumerable, get: () => wrapped });
                    cleanups.push(() => Object.defineProperty(object, key, descriptor));
                }
            }
        }
        return wrapped;
    }
    function lookup(id: string, filter: Filter, options: Options): any {
        const module = cache[id];
        if (!module?.exports) return;
        const exports = exposeCss(module.exports);
        const raw = { ...module, id, declarations: declarations.get(id) ?? exports };
        const isSource = !!(filter as any)[sourceFilter];
        let match = safe(filter, exports, raw, id) ? exports : undefined;
        if (!match && (options.searchExports || !isSource)) match = values(exports).find(value => safe(filter, value, raw, id));
        if (!match) return;
        if (options.raw) return raw;
        const candidates = options.mapDeclarations || options.declarationFilter ? values(raw.declarations) : [exports, ...values(exports)];
        if (options.map) return Object.fromEntries(Object.entries(options.map).map(([name, test]) => [name, prepare(candidates.find(value => safe(test, value, raw, id)), test, id)]));
        if (options.declarationFilter) return prepare(candidates.find(value => safe(options.declarationFilter!, value, raw, id)), options.declarationFilter, id);
        return prepare(match, filter, id);
    }
    function getModule(filter: Filter, options: Options = {}): any {
        for (const id in cache) { const result = lookup(id, filter, options); if (result) return result; }
        return undefined;
    }
    const listener = (_exports: unknown, id: PropertyKey) => {
        if (disposed) return;
        for (const query of pending) {
            const result = lookup(String(id), query.filter, query.options);
            if (result) { pending.delete(query); query.resolve(result); }
        }
    };
    moduleListeners.add(listener);
    return {
        Filters, getModule,
        getByKeys: (...keys: string[]) => getModule(Filters.byKeys(...keys)),
        getBulk: (...queries: Options[]) => queries.map(query => getModule(query.filter!, query) ?? (query.map ? {} : undefined)),
        waitForModule: (filter: Filter, options: Options = {}) => new Promise(resolve => {
            const result = getModule(filter, options);
            if (result) resolve(result);
            else pending.add({ filter, options, resolve });
        }),
        dispose() { disposed = true; moduleListeners.delete(listener); pending.clear(); for (const cleanup of cleanups.reverse()) cleanup(); cleanups.length = 0; }
    };
}
