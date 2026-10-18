/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type Status = "online" | "idle" | "dnd" | "invisible";

export interface VoiceStatusSettings {
    disconnectedStatus: Status;
    mutedSoundStatus: Status;
    mutedMicrophoneStatus: Status;
    connectedStatus: Status;
}

export function chooseStatus(connected: boolean, deafened: boolean, muted: boolean, settings: VoiceStatusSettings): Status {
    if (!connected) return settings.disconnectedStatus;
    if (deafened) return settings.mutedSoundStatus;
    if (muted) return settings.mutedMicrophoneStatus;
    return settings.connectedStatus;
}
