/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const events = ["online", "idle", "dnd", "offline", "login", "mobile", "custom", "playing", "listening", "streaming", "screensharing"] as const;
export type Event = typeof events[number];
export type Mode = "off" | "toast" | "desktop";
export interface Snapshot {
    status: string;
    mobile: boolean;
    custom: string;
    playing: string;
    listening: string;
    streaming: string;
    screensharing: string;
    game: string;
    song: string;
    artist: string;
}
export const defaultTemplates: Record<Event, string> = {
    online: "$user changed status to $status", idle: "$user changed status to $status", dnd: "$user changed status to $status", offline: "$user went offline",
    login: "$user logged in ($status)", mobile: "$user is now using mobile", custom: "$user changed custom status to $custom",
    playing: "$user changed game: $game", listening: "$user changed music: $song by $artist", streaming: "$user changed stream: $game", screensharing: "$user changed screen sharing: $game"
};
export function changes(previous: Snapshot, current: Snapshot): Event[] {
    const result: Event[] = [];
    if (previous.status !== current.status && ["online", "idle", "dnd", "offline"].includes(current.status)) result.push(current.status as Event);
    if (previous.status === "offline" && current.status !== "offline") result.push("login");
    if (current.status === "offline") return result;
    if (!previous.mobile && current.mobile) result.push("mobile");
    for (const event of ["custom", "playing", "listening", "streaming", "screensharing"] as const) if (previous[event] !== current[event]) result.push(event);
    return result;
}
export function renderTemplate(template: string, values: Record<string, string>): string {
    return template.replace(/\$(statusOld|status|custom|artist|song|game|user|nick)\b/g, (match, key) => values[key] ?? match);
}
