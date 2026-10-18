/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import { TextCompat } from "@components/BaseText";
import { Heading } from "@components/Heading";
import type { PluginNative } from "@utils/types";
import { createRoot, Menu, Modal, openModal, React, ReactDOM, showToast } from "@webpack/common";

import { openPackEditor } from "./PackEditor";
import { createPatcher, EventEmitter, findInTree, path } from "./primitives";
import { createWebpack } from "./webpack";

const native = VencordNative.pluginHelpers.BetterAnimations as PluginNative<typeof import("./native")>;
interface Storage { upstream?: Record<string, unknown>; }

function wrapInHooks(callback: (...args: any[]) => any) {
    return (...args: any[]) => {
        const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
        const legacy = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?.ReactCurrentDispatcher;
        const holder = internals ?? legacy;
        const key = internals ? "H" : "current";
        if (!holder) return callback(...args);
        const original = holder[key];
        holder[key] = {
            useState: (value: any) => [typeof value === "function" ? value() : value, () => {}],
            useReducer: (_reduce: any, value: any, init: any) => [init ? init(value) : value, () => {}],
            useRef: (current: any) => ({ current }), useMemo: (fn: any) => fn(), useCallback: (fn: any) => fn,
            useEffect() {}, useLayoutEffect() {}, useInsertionEffect() {}, useImperativeHandle() {}, useDebugValue() {},
            useContext: (context: any) => context._currentValue,
            useSyncExternalStore: (_subscribe: any, snapshot: any) => snapshot(), useId: () => "better-animations",
            use: (value: any) => value?._currentValue
        };
        try { return callback(...args); } finally { holder[key] = original; }
    };
}

export function createBridge(storage: Storage) {
    const Webpack = createWebpack();
    const Patcher = createPatcher();
    const styles = new Map<string, HTMLStyleElement>();
    const watchers = new Set<ReturnType<typeof setInterval>>();
    const notifications = new Set<() => void>();
    // The original engine expects synchronous local pack operations. IPC restricts these to its own pack directory.
    const fsCall = (operation: string, input: string, value?: string): any => native.syncFs(operation, input, value);
    const fs = {
        existsSync: (input: string) => fsCall("exists", input),
        mkdirSync: (input: string) => fsCall("mkdir", input),
        readFileSync: (input: string) => fsCall("read", input),
        readdirSync: (input: string) => fsCall("list", input),
        writeFileSync: (input: string, value: string) => fsCall("write", input, value),
        unlinkSync: (input: string) => fsCall("unlink", input),
        renameSync: (input: string, destination: string) => fsCall("rename", input, destination),
        statSync(input: string) {
            const stat = fsCall("stat", input);
            return { ...stat, mtime: new Date(stat.mtimeMs), ctime: new Date(stat.ctimeMs), birthtime: new Date(stat.birthtimeMs), isFile: () => stat.file, isDirectory: () => stat.directory };
        },
        watch(input: string, _options: unknown, callback: (event: string, filename: string) => void) {
            let previous = fsCall("snapshot", input) as Record<string, number>;
            const timer = setInterval(() => {
                try {
                    const next = fsCall("snapshot", input) as Record<string, number>;
                    const before = previous;
                    previous = next;
                    for (const name of new Set([...Object.keys(before), ...Object.keys(next)])) {
                        if (before[name] !== next[name]) callback(name in before && name in next ? "change" : "rename", name);
                    }
                } catch (error) { console.error("[BetterAnimations] Pack watcher", error); }
            }, 1000);
            watchers.add(timer);
            return { close() { clearInterval(timer); watchers.delete(timer); } };
        }
    };
    let themes: { id: string; name: string; }[] = [];
    void VencordNative.themes.getThemesList().then(items => { themes = items.map(item => ({ ...item, id: item.fileName })); });
    const className = (...args: any[]): string => args.flatMap(value => typeof value === "string" ? [value] : Array.isArray(value) ? [className(...value)] : value && typeof value === "object" ? Object.keys(value).filter(key => value[key]) : []).filter(Boolean).join(" ");
    const api = {
        Webpack, Patcher, version: "Cutcord port",
        Utils: {
            className, findInTree,
            semverCompare: (current: string, next: string) => {
                const left = current.split(/[.+-]/).map(Number);
                const right = next.split(/[.+-]/).map(Number);
                for (let i = 0; i < Math.max(left.length, right.length); i++) { const delta = (right[i] || 0) - (left[i] || 0); if (delta) return Math.sign(delta); }
                return 0;
            }
        },
        ReactUtils: { wrapInHooks },
        DOM: {
            addStyle(id: string, css: string) {
                styles.get(id)?.remove();
                const style = document.createElement("style"); style.textContent = css; style.dataset.betterAnimations = id;
                document.head.append(style); styles.set(id, style);
            },
            removeStyle(id: string) { styles.get(id)?.remove(); styles.delete(id); }
        },
        Data: {
            load: (key: string) => storage.upstream?.[key] === undefined ? undefined : JSON.parse(JSON.stringify(storage.upstream[key])),
            save: (key: string, value: unknown) => { storage.upstream = JSON.parse(JSON.stringify({ ...storage.upstream, [key]: value })); }
        },
        Plugins: { folder: native.syncRoot() }, Hooks: {},
        UI: {
            showToast: (message: string) => showToast(message),
            showInviteModal: (code: string) => VencordNative.native.openExternal(`https://discord.gg/${encodeURIComponent(code)}`),
            showChangelogModal: (content: any) => openModal(props => <Modal {...props} title={content.title ?? "BetterAnimations"} size="lg"><div style={{ whiteSpace: "pre-wrap" }}>{(content.changes ?? []).map((change: any, i: number) => <div key={i}><h3>{change.title}</h3>{change.items?.join("\n") ?? change.description}</div>)}</div></Modal>),
            showNotification: (options: any) => {
                const container = document.createElement("div");
                Object.assign(container.style, { position: "fixed", bottom: `${20 + notifications.size * 100}px`, right: "20px", zIndex: "2147483647", width: "340px", padding: "16px", borderRadius: "8px", background: "var(--background-surface-high, #292b2f)", color: "var(--text-default, white)", boxShadow: "0 4px 20px #0006" });
                document.body.append(container);
                const root = createRoot(container);
                let visible = true;
                let timeout: ReturnType<typeof setTimeout> | undefined;
                const close = () => {
                    if (!visible) return;
                    visible = false; clearTimeout(timeout); notifications.delete(close);
                    queueMicrotask(() => { root.unmount(); container.remove(); });
                    options.onClose?.();
                };
                notifications.add(close);
                root.render(<div><strong>{options.title ?? "BetterAnimations"}</strong><button aria-label="Dismiss notification" onClick={close} style={{ float: "right" }}>x</button><div>{options.content}</div>{options.actions?.map((action: any, i: number) => <button key={i} onClick={() => action.onClick?.()}>{action.label ?? action.title}</button>)}</div>);
                if (Number.isFinite(options.duration ?? 5000) && (options.duration ?? 5000) > 0) timeout = setTimeout(close, options.duration ?? 5000);
                return { close, isVisible: () => visible };
            }
        },
        Net: {
            async fetch(url: string, options?: { signal?: AbortSignal; }) {
                options?.signal?.throwIfAborted();
                const response = await native.fetchResource(url);
                options?.signal?.throwIfAborted();
                return new Response(response.text, { status: response.status, statusText: response.statusText, headers: response.headers });
            }
        },
        ContextMenu: { Menu: Menu.Menu, Group: Menu.MenuGroup, Item: Menu.MenuItem, RadioItem: Menu.MenuRadioItem },
        Themes: { getAll: () => themes, isEnabled: (id: string) => Settings.enabledThemes.includes(id), disable: (id: string) => { Settings.enabledThemes = Settings.enabledThemes.filter(name => name !== id); } }
    };
    function BdApi() { return api; }
    Object.assign(BdApi, { React, ReactDOM, Utils: api.Utils });
    let packValidator: ((text: string) => string | null) | undefined;
    let settingsContainer: HTMLDivElement | undefined;
    let closeSettings: (() => void) | undefined;
    function openSettings(Component: any) {
        if (settingsContainer) return;
        settingsContainer = document.createElement("div");
        Object.assign(settingsContainer.style, { position: "fixed", inset: "0", zIndex: "100", background: "var(--background-base-lowest, #202127)", color: "var(--text-default, white)" });
        document.body.append(settingsContainer);
        const root = createRoot(settingsContainer);
        const container = settingsContainer;
        closeSettings = () => { settingsContainer = undefined; closeSettings = undefined; queueMicrotask(() => { root.unmount(); container.remove(); }); };
        root.render(<Component />);
    }
    function SidebarView({ sections, section, onSetSection, title, onClose }: any) {
        const mainRef = React.useRef<HTMLElement>(null);
        const refToScroller = React.useMemo(() => ({ current: { getScrollerNode: () => mainRef.current, scrollTo: (options: ScrollToOptions) => mainRef.current?.scrollTo(options), getScrollState: () => ({ scrollTop: mainRef.current?.scrollTop ?? 0, scrollHeight: mainRef.current?.scrollHeight ?? 0, offsetHeight: mainRef.current?.offsetHeight ?? 0 }) } }), []);
        const selected = sections.find((item: any) => item.section === section);
        const Content = selected?.element;
        const Notice = selected?.notice?.element;
        return <div style={{ height: "100%", display: "flex", maxWidth: "1600px", margin: "auto" }}>
            <aside style={{ width: "230px", flexShrink: 0, overflow: "auto", padding: "24px 12px", borderRight: "1px solid var(--border-subtle, #555)" }}><h2>{title}</h2><button onClick={() => packValidator && openPackEditor(packValidator)}>Pack editor</button>{sections.map((item: any, index: number) => {
                if (item.section === "DIVIDER") return <hr key={index} />;
                if (item.section === "CUSTOM") { const Custom = item.element; return Custom ? <Custom key={index} /> : null; }
                return <button key={index} onClick={() => onSetSection(item.section)} style={{ display: "flex", gap: "8px", alignItems: "center", width: "100%", border: 0, padding: "10px", textAlign: "left", borderRadius: "4px", background: item.section === section ? "var(--background-modifier-selected, #404249)" : "none", color: "inherit", cursor: "pointer" }}>{item.icon}{item.label}</button>;
            })}</aside>
            <main ref={mainRef} style={{ padding: "30px", overflow: "auto", flex: 1, minWidth: 0, position: "relative" }}>{Content && <Content {...selected.elementProps} refToScroller={refToScroller} />}{Notice && <Notice />}</main>
            <button aria-label="Close BetterAnimations" onClick={onClose} style={{ position: "absolute", right: "12px", top: "12px", zIndex: 2 }}>Close</button>
        </div>;
    }
    return {
        BdApi, fs, path, events: EventEmitter, SidebarView, openSettings,
        setPackValidator: (validate: (text: string) => string | null) => { packValidator = validate; },
        closeSettings: () => closeSettings?.(), isSettingsOpen: () => !!settingsContainer,
        components: {
            Text: TextCompat, Heading,
            Switch: ({ checked, onChange, disabled, ...props }: any) => <input {...props} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange?.(event.target.checked)} />,
            Checkbox: ({ value, checked, onChange, children, ...props }: any) => <label><input {...props} type="checkbox" checked={checked ?? value} onChange={event => onChange?.(event, event.target.checked)} />{children}</label>,
            Stack: ({ children, direction, gap = 8, align, justify, className, style }: any) => <div className={className} style={{ display: "flex", flexDirection: direction === "horizontal" || direction === "row" ? "row" : "column", gap, alignItems: align, justifyContent: justify, ...style }}>{children}</div>,
            Breadcrumbs: ({ breadcrumbs = [], renderBreadcrumb, onBreadcrumbClick }: any) => <nav>{breadcrumbs.map((item: any, index: number) => <button key={index} onClick={() => onBreadcrumbClick?.(item)}>{renderBreadcrumb?.(item) ?? item.label ?? item.id}</button>)}</nav>,
            Badge: ({ children, text, className }: any) => <span className={className}>{children ?? text}</span>
        },
        electron: { shell: { openPath: (input: string) => native.reveal(input, true), showItemInFolder: (input: string) => native.reveal(input, false) } },
        dispose() {
            closeSettings?.(); Webpack.dispose(); Patcher.dispose();
            for (const close of [...notifications]) close();
            for (const style of styles.values()) style.remove();
            for (const timer of watchers) clearInterval(timer);
            styles.clear(); watchers.clear();
        }
    };
}
