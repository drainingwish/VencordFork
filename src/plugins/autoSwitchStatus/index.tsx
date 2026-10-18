/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Native Vencord port of AutoSwitchStatus 1.9.6 by nicola02nb.
// Source: https://github.com/nicola02nb/BetterDiscord-Stuff/tree/main/Plugins/AutoSwitchStatus

import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { Paragraph } from "@components/Paragraph";
import { EquicordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, StartAt } from "@utils/types";
import { MediaEngineStore, RTCConnectionStore, showToast } from "@webpack/common";

import { chooseStatus, Status } from "./model";

const logger = new Logger("AutoSwitchStatus");
const statusSetting = getUserSettingLazy<Status>("status", "status");
const labels: Record<Status, string> = { online: "Online", idle: "Idle", dnd: "Do Not Disturb", invisible: "Invisible" };
const options = (selected: Status) => (Object.entries(labels) as [Status, string][]).map(([value, label]) => ({ value, label, default: selected === value }));
const settings = definePluginSettings({
    mutedMicrophoneStatus: { type: OptionType.SELECT, description: "Status while your microphone is muted", options: options("online"), onChange: scheduleUpdate },
    mutedSoundStatus: { type: OptionType.SELECT, description: "Status while deafened", options: options("idle"), onChange: scheduleUpdate },
    connectedStatus: { type: OptionType.SELECT, description: "Status while connected to voice", options: options("online"), onChange: scheduleUpdate },
    disconnectedStatus: { type: OptionType.SELECT, description: "Status while disconnected from voice", options: options("invisible"), onChange: scheduleUpdate },
    showToast: { type: OptionType.BOOLEAN, description: "Show a toast when your status changes", default: true },
    restoreOnStop: { type: OptionType.BOOLEAN, description: "Restore your previous status when disabling the plugin", default: true }
});

let running = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let originalStatus: Status | undefined;
let lastApplied: Status | undefined;
let nextUpdate = 0;
let updating = false;
let inFlight: Promise<void> | undefined;
let generation = 0;

function scheduleUpdate(): void {
    if (!running) return;
    clearTimeout(timer);
    timer = setTimeout(() => { inFlight = updateStatus(); }, Math.max(100, nextUpdate - Date.now()));
}

async function updateStatus(): Promise<void> {
    if (!running || updating) return;
    const target = chooseStatus(RTCConnectionStore.isConnected(), MediaEngineStore.isSelfDeaf(), MediaEngineStore.isSelfMute(), settings.store);
    if (statusSetting?.getSetting() === target) return;
    const currentGeneration = generation;
    updating = true;
    nextUpdate = Date.now() + 15_000;
    try {
        await statusSetting?.updateSetting(target);
        if (currentGeneration !== generation) return;
        lastApplied = target;
        if (running && settings.store.showToast) showToast(`Status changed to ${labels[target]}`);
    } catch (error) {
        logger.error("Could not update status", error);
    } finally {
        updating = false;
        if (running) scheduleUpdate();
    }
}

export default definePlugin({
    name: "AutoSwitchStatus",
    description: "Change your online status when connecting to voice, muting, deafening, or disconnecting.",
    authors: [EquicordDevs.nicola02nb],
    dependencies: ["UserSettingsAPI"],
    settings,
    startAt: StartAt.WebpackReady,
    settingsAboutComponent: () => <Paragraph>Deafened takes priority over muted. Status changes are limited to one every 15 seconds. Disable StatusWhileActive if it is also changing your status.</Paragraph>,
    start() {
        generation++;
        originalStatus = statusSetting?.getSetting();
        lastApplied = undefined;
        nextUpdate = 0;
        running = true;
        RTCConnectionStore.addChangeListener(scheduleUpdate);
        MediaEngineStore.addChangeListener(scheduleUpdate);
        scheduleUpdate();
    },
    stop() {
        running = false;
        clearTimeout(timer);
        RTCConnectionStore.removeChangeListener(scheduleUpdate);
        MediaEngineStore.removeChangeListener(scheduleUpdate);
        const stoppedGeneration = generation;
        const restore = originalStatus;
        void (inFlight ?? Promise.resolve()).then(() => {
            if (!running && generation === stoppedGeneration && settings.store.restoreOnStop && restore && lastApplied && statusSetting?.getSetting() === lastApplied) {
                return statusSetting.updateSetting(restore);
            }
        }).catch(error => logger.error("Could not restore status", error));
    }
});
