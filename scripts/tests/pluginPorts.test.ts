/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";

import { chooseStatus } from "../../src/plugins/autoSwitchStatus/model";
import { captureDeclarations, captureFind, declarations, instrumentFactory } from "../../src/plugins/betterAnimations.desktop/capture";
import { createPatcher, EventEmitter, path } from "../../src/plugins/betterAnimations.desktop/primitives";
import { changes, renderTemplate, Snapshot } from "../../src/plugins/friendNotifications/model";

test("voice status honors disconnect/deafen/mute priority", () => {
    const settings = { disconnectedStatus: "invisible", mutedSoundStatus: "dnd", mutedMicrophoneStatus: "idle", connectedStatus: "online" } as const;
    assert.equal(chooseStatus(false, true, true, settings), "invisible");
    assert.equal(chooseStatus(true, true, true, settings), "dnd");
    assert.equal(chooseStatus(true, false, true, settings), "idle");
    assert.equal(chooseStatus(true, false, false, settings), "online");
});

test("friend changes handle login, offline and activity updates without duplicate polls", () => {
    const previous: Snapshot = { status: "offline", mobile: false, custom: "", playing: "", listening: "", streaming: "", screensharing: "", game: "", song: "", artist: "" };
    assert.deepEqual(changes(previous, previous), []);
    const current = { ...previous, status: "online", mobile: true, playing: "Game", custom: "Hello" };
    assert.deepEqual(changes(previous, current), ["online", "login", "mobile", "custom", "playing"]);
    assert.deepEqual(changes(current, previous), ["offline"]);
    assert.deepEqual(changes(current, { ...current, listening: "New song" }), ["listening"]);
    assert.equal(renderTemplate("$user: $statusOld -> $status ($song)", { user: "<name>", statusOld: "idle", status: "online", song: "$user" }), "<name>: idle -> online ($user)");
});

test("captured lexical bindings remain patchable with strict mode and destructuring", () => {
    const source = '0,function(module){"use strict";const value=2,{count}= {count:3};function read(){return value+count}module.exports={read}}';
    const transformed = instrumentFactory(source).replaceAll("$self", "bridge");
    const factory = Function("bridge", `return (${transformed})`)({ captureDeclarations });
    const module = { id: "fixture", exports: {} as any };
    factory(module);
    assert.equal(module.exports.read(), 5);
    const captured = declarations.get("fixture")!;
    captured.value = 7;
    assert.equal(module.exports.read(), 10);
    const patcher = createPatcher();
    patcher.after(captured, "read", (_self, _args, result) => result * 2);
    // Exported references do not change, but all callers through the actual lexical binding do.
    assert.equal((captured.read as () => number)(), 20);
    patcher.dispose();
    assert.equal((captured.read as () => number)(), 10);
    assert.equal(instrumentFactory("0,()=>42"), "0,()=>42");
    assert.ok(captureFind.test('function(){return ["scrim","lightbox"]}'));
    assert.ok(!captureFind.test("function(){return 42}"));
    declarations.delete("fixture");
});

test("runtime patches preserve receiver, arguments, returned values and restore descriptors", () => {
    const object = { base: 3, read(value: number) { return this.base + value; } };
    const patcher = createPatcher();
    const undoBefore = patcher.before(object, "read", (_self, args) => { args[0] *= 2; });
    patcher.after(object, "read", (_self, _args, result) => result + 1);
    assert.equal(object.read(4), 12);
    patcher.dispose();
    undoBefore();
    assert.equal(object.read(4), 7);
});

test("pack path joining and event subscriptions match the engine's requirements", () => {
    assert.equal(path.resolve("C:\\packs", "BetterAnimations", "test.json"), "C:/packs/BetterAnimations/test.json");
    assert.equal(path.resolve("/packs", "BetterAnimations", "..", "test.json"), "/packs/test.json");
    const emitter = new EventEmitter();
    let calls = 0;
    emitter.once("event", () => calls++);
    emitter.emit("event"); emitter.emit("event");
    assert.equal(calls, 1);
    assert.equal(emitter.listenerCount("event"), 0);
});


test("native animation files cannot escape their dedicated folder, including junctions", async () => {
    const fixture = mkdtempSync(join(tmpdir(), "cutcord-port-test-"));
    try {
        const result = await build({
            entryPoints: ["src/plugins/betterAnimations.desktop/native.ts"], bundle: true, platform: "node", format: "cjs", write: false,
            plugins: [{ name: "native-test-host", setup(builder) {
                builder.onResolve({ filter: /^@main\/utils\/constants$/ }, () => ({ path: "constants", namespace: "test-host" }));
                builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "test-host" }));
                builder.onLoad({ filter: /.*/, namespace: "test-host" }, args => ({ contents: args.path === "constants" ? `export const DATA_DIR = ${JSON.stringify(fixture)};` : "export const shell = {};" }));
            } }]
        });
        const module = { exports: {} as any };
        Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
        const native = module.exports;
        const parent = native.syncRoot(null);
        const root = join(parent, "BetterAnimations");
        native.syncFs(null, "write", "fixture.pack.json", '{"name":"Fixture"}');
        assert.equal(native.syncFs(null, "read", "fixture.pack.json"), '{"name":"Fixture"}');
        assert.throws(() => native.syncFs(null, "read", "../outside.json"), /inside the BetterAnimations folder/);
        assert.throws(() => native.syncFs(null, "write", "script.js", "bad"), /Only animation JSON/);
        assert.throws(() => native.syncFs(null, "rename", "fixture.pack.json", "../escape.json"), /inside the BetterAnimations folder/);
        const outside = join(fixture, "outside"); mkdirSync(outside);
        symlinkSync(outside, join(root, "link"), process.platform === "win32" ? "junction" : "dir");
        assert.throws(() => native.syncFs(null, "write", "link/escape.json", "bad"), /outside the pack folder/);
        native.syncFs(null, "unlink", "fixture.pack.json");
        assert.equal(native.syncFs(null, "exists", "fixture.pack.json"), false);
    } finally {
        assert.ok(relative(tmpdir(), fixture).startsWith("cutcord-port-test-"));
        rmSync(fixture, { recursive: true, force: true });
    }
});


test("disabling AutoSwitchStatus during an in-flight update still restores the original status", async () => {
    let status = "online";
    let finish: (() => void) | undefined;
    const listeners = new Set<() => void>();
    const host = {
        statusSetting: { getSetting: () => status, updateSetting(target: string) {
            if (target === "invisible") return new Promise<void>(resolve => { finish = () => { status = target; resolve(); }; });
            status = target; return Promise.resolve();
        } },
        store: { isConnected: () => false, isSelfDeaf: () => false, isSelfMute: () => false,
            addChangeListener: (listener: () => void) => listeners.add(listener), removeChangeListener: (listener: () => void) => listeners.delete(listener) }
    };
    const result = await build({
        entryPoints: ["src/plugins/autoSwitchStatus/index.tsx"], bundle: true, platform: "node", format: "cjs", write: false,
        plugins: [{ name: "status-test-host", setup(builder) {
            builder.onResolve({ filter: /^@/ }, args => ({ path: args.path, namespace: "status-host" }));
            builder.onLoad({ filter: /.*/, namespace: "status-host" }, args => {
                const sources: Record<string, string> = {
                    "@api/Settings": 'export const definePluginSettings = definition => ({ store: Object.fromEntries(Object.entries(definition).map(([key,value]) => [key, value.default ?? value.options?.find(option=>option.default)?.value])) });',
                    "@api/UserSettings": 'export const getUserSettingLazy = () => host.statusSetting;',
                    "@webpack/common": 'export const RTCConnectionStore = host.store; export const MediaEngineStore = host.store; export const showToast = () => {};',
                    "@utils/constants": 'export const EquicordDevs = {nicola02nb: {name:"nicola02nb", id:0n}};',
                    "@utils/Logger": 'export class Logger { error() {} }',
                    "@utils/types": 'export default value=>value; export const OptionType={SELECT:"select",BOOLEAN:"boolean"}; export const StartAt={WebpackReady:"WebpackReady"};',
                    "@components/Paragraph": 'export const Paragraph = () => null;'
                };
                return { contents: sources[args.path] };
            });
        } }]
    });
    const module = { exports: {} as any };
    Function("host", "module", "exports", result.outputFiles[0].text)(host, module, module.exports);
    const plugin = module.exports.default;
    try {
        plugin.start();
        await new Promise(resolve => setTimeout(resolve, 130));
        assert.ok(finish, "status update began");
        plugin.stop();
        finish!();
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(status, "online");
        assert.equal(listeners.size, 0);
    } finally { plugin.stop(); }
});
