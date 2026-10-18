/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, StartAt } from "@utils/types";

import { createBridge } from "./bridge";
import { captureDeclarations, captureFind, instrumentFactory } from "./capture";
import { openPackEditor } from "./PackEditor";
import createEngine, { AnimationEngine } from "./vendor/engine";

let engine: AnimationEngine | undefined;
let startupTimer: ReturnType<typeof setTimeout> | undefined;
let startupObserver: MutationObserver | undefined;
let running = false;
let bridge: ReturnType<typeof createBridge> | undefined;
const settings = definePluginSettings({
    editor: {
        type: OptionType.COMPONENT,
        component: () => <div><Paragraph>Open the full animation editor to configure effects, create packs, import files, and browse the online pack catalog.</Paragraph><Button onClick={() => engine?.getSettingsPanel()}>Open BetterAnimations</Button><Button onClick={() => engine && openPackEditor(text => engine!.validatePack(text))}>Open pack editor</Button></div>
    }
}).withPrivateSettings<{ upstream?: Record<string, unknown>; }>();

export default definePlugin({
    name: "BetterAnimations",
    description: "Full BetterAnimations engine, pack editor and online catalog, adapted for Cutcord/Vencord.",
    authors: [Devs.arg0NNY],
    settings,
    startAt: StartAt.WebpackReady,
    patches: [{ find: captureFind, all: true, replacement: { match: /^[\s\S]+$/, replace: source => instrumentFactory(source) } }],
    captureDeclarations,
    openEditor: () => engine?.getSettingsPanel(),
    openPackEditor: () => engine && openPackEditor(text => engine!.validatePack(text)),
    start() {
        running = true;
        const initialize = () => {
            if (!running || bridge) return;
            startupObserver?.disconnect(); clearTimeout(startupTimer);
            bridge = createBridge(settings.store);
            try { engine = createEngine(bridge.BdApi, bridge); bridge.setPackValidator(text => engine!.validatePack(text)); engine.start(); }
            catch (error) {
                new Logger("BetterAnimations").error("Could not initialize animations", error);
                try { engine?.stop(); } finally { bridge.dispose(); engine = undefined; bridge = undefined; }
            }
        };
        const ready = () => {
            if (!document.querySelector('[data-list-id="guildsnav"]')) return;
            startupObserver?.disconnect();
            startupTimer = setTimeout(initialize, 750);
        };
        startupObserver = new MutationObserver(ready);
        startupObserver.observe(document.body, { childList: true, subtree: true });
        ready();
    },
    stop() {
        running = false; clearTimeout(startupTimer); startupObserver?.disconnect();
        try { engine?.stop(); }
        finally { bridge?.dispose(); engine = undefined; bridge = undefined; }
    }
});
