/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Native Vencord port of FriendNotifications 2.1.6 by DevilBro.
// Source: https://github.com/mwittrien/BetterDiscordAddons/tree/master/Plugins/FriendNotifications

import { addServerListElement, removeServerListElement, ServerListRenderPosition } from "@api/ServerList";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { openPrivateChannel } from "@utils/discord";
import definePlugin, { OptionType, StartAt } from "@utils/types";
import { Menu, Modal, openModal, PresenceStore, RelationshipStore, useEffect, UserStore, useState, useStateFromStores, VoiceStateStore } from "@webpack/common";

import { changes, defaultTemplates, Event, events, Mode, renderTemplate, Snapshot } from "./model";

interface Rule { disabled?: boolean; history?: boolean; modes?: Partial<Record<Event, Mode>>; }
interface LogEntry { id: string; name: string; text: string; event: Event; time: number; avatar?: string; }
const options = (value: Mode) => (["off", "toast", "desktop"] as const).map(mode => ({ label: mode === "off" ? "Disabled" : mode === "toast" ? "Toast" : "Desktop", value: mode, default: value === mode }));
const eventSetting = (event: Event, mode: Mode) => ({ type: OptionType.SELECT as const, description: `Notification when ${event} changes`, options: options(mode) });
const settings = definePluginSettings({
    watchFriends: { type: OptionType.BOOLEAN, description: "Observe all friends", default: true },
    extraUsers: { type: OptionType.STRING, description: "Additional user IDs to observe, separated by spaces or commas (presence must already be available to Discord)", default: "" },
    online: eventSetting("online", "toast"), offline: eventSetting("offline", "toast"), idle: eventSetting("idle", "off"), dnd: eventSetting("dnd", "off"),
    login: eventSetting("login", "off"), mobile: eventSetting("mobile", "off"), custom: eventSetting("custom", "off"), playing: eventSetting("playing", "off"),
    listening: eventSetting("listening", "off"), streaming: eventSetting("streaming", "off"), screensharing: eventSetting("screensharing", "off"),
    muteOnDND: { type: OptionType.BOOLEAN, description: "Mute notifications while your status is Do Not Disturb", default: false },
    openOnClick: { type: OptionType.BOOLEAN, description: "Open the user's DM when clicking a notification", default: false },
    showTimestamp: { type: OptionType.BOOLEAN, description: "Include the time in notifications", default: false },
    addOnlineCount: { type: OptionType.BOOLEAN, description: "Show online friends and a history button in the server list", default: true },
    checkInterval: { type: OptionType.NUMBER, description: "Fallback presence check interval, in seconds", default: 10, isValid: value => typeof value === "number" && Number.isFinite(value) && value >= 5 && value <= 300 || "Use a value from 5 to 300 seconds", onChange: restartPolling },
    toastSeconds: { type: OptionType.NUMBER, description: "Toast duration, in seconds", default: 5, isValid: value => typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 60 || "Use a value from 1 to 60 seconds" },
    position: { type: OptionType.SELECT, description: "Toast position", options: [{ label: "Bottom right", value: "right", default: true }, { label: "Bottom left", value: "left" }] },
    customize: { type: OptionType.COMPONENT, component: () => <Customization /> }
}).withPrivateSettings<{ rules?: Record<string, Rule>; templates?: Partial<Record<Event, string>>; sounds?: Partial<Record<Event, string>>; }>();

let running = false;
let connected = true;
let baseline = new Map<string, Snapshot>();
let timer: ReturnType<typeof setInterval> | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;
let host: HTMLDivElement | undefined;
const disposers = new Set<() => void>();
const history: LogEntry[] = [];
const listeners = new Set<() => void>();
function emit() { for (const listener of listeners) listener(); }
function useHistory() {
    const [, refresh] = useState(0);
    useEffect(() => { const listener = () => refresh(value => value + 1); listeners.add(listener); return () => { listeners.delete(listener); }; }, []);
    return history;
}
function userIds() {
    return new Set([...(settings.store.watchFriends ? RelationshipStore.getFriendIDs() : []), ...settings.store.extraUsers.split(/[\s,;]+/).filter(id => /^\d{15,22}$/.test(id))]);
}
function snapshot(id: string): Snapshot {
    const raw = PresenceStore.getStatus(id);
    const status = raw === "invisible" || !raw ? "offline" : raw;
    const activities = PresenceStore.getActivities(id) ?? [];
    const activity = (type: number) => activities.find(item => item.type === type);
    const signature = (type: number) => { const item = activity(type); return item ? JSON.stringify([item.name, item.details, item.state, item.emoji?.id, item.emoji?.name]) : ""; };
    const playing = activity(0);
    const listening = activity(2);
    const streaming = activity(1);
    const custom = activity(4);
    const voice = VoiceStateStore.getVoiceStateForUser(id);
    return {
        status, mobile: !!PresenceStore.getClientStatus(id)?.mobile,
        custom: [custom?.emoji?.name, custom?.state].filter(Boolean).join(" "),
        playing: signature(0), listening: signature(2), streaming: signature(1), screensharing: voice?.selfStream ? voice.channelId ?? "" : "",
        game: streaming?.details ?? playing?.name ?? "nothing", song: listening?.details ?? "nothing", artist: listening?.state ?? "unknown artist"
    };
}
function ruleFor(id: string): Rule { return settings.store.rules?.[id] ?? {}; }
function modeFor(id: string, event: Event): Mode { return ruleFor(id).modes?.[event] ?? settings.store[event]; }
function setRule(id: string, rule: Rule) { settings.store.rules = JSON.parse(JSON.stringify({ ...settings.store.rules, [id]: rule })); }
function scheduleCheck() { if (!running) return; clearTimeout(debounce); debounce = setTimeout(check, 200); }
function restartPolling() { clearInterval(timer); if (running) timer = setInterval(check, Math.max(5, settings.store.checkInterval) * 1000); }
function check() {
    if (!running || !connected || !UserStore.getCurrentUser()) { baseline.clear(); return; }
    const next = new Map<string, Snapshot>();
    for (const id of userIds()) {
        if (id === UserStore.getCurrentUser()?.id || RelationshipStore.isBlockedOrIgnored(id) || !UserStore.getUser(id) || ruleFor(id).disabled) continue;
        const current = snapshot(id);
        next.set(id, current);
        const previous = baseline.get(id);
        if (!previous) continue;
        const detected = changes(previous, current);
        for (const event of detected) {
            if (["online", "idle", "dnd"].includes(event) && detected.includes("login") && modeFor(id, "login") !== "off") continue;
            notify(id, event, previous, current);
        }
    }
    baseline = next;
}
function notify(id: string, event: Event, previous: Snapshot, current: Snapshot) {
    const user = UserStore.getUser(id);
    if (!user) return;
    const name = user.globalName || user.username;
    const text = renderTemplate(settings.store.templates?.[event] || defaultTemplates[event], {
        user: name, nick: RelationshipStore.getNickname(id) || name, status: current.status, statusOld: previous.status,
        custom: current.custom || "(cleared)", game: event === "screensharing" ? current.screensharing ? "started" : "stopped" : current.game,
        song: current.song, artist: current.artist
    });
    const entry: LogEntry = { id, name, text, event, time: Date.now(), avatar: user.getAvatarURL?.() };
    if (ruleFor(id).history !== false) { history.unshift(entry); history.splice(500); emit(); }
    const mode = modeFor(id, event);
    if (mode === "off" || settings.store.muteOnDND && PresenceStore.getStatus(UserStore.getCurrentUser().id) === "dnd") return;
    const body = settings.store.showTimestamp ? `[${new Date(entry.time).toLocaleTimeString()}] ${text}` : text;
    const onClick = () => { if (settings.store.openOnClick) openPrivateChannel(id); };
    if (mode === "desktop" && typeof Notification !== "undefined" && Notification.permission === "granted") {
        const notification = new Notification("FriendNotifications", { body, icon: entry.avatar, silent: true });
        notification.onclick = () => { onClick(); notification.close(); };
        const cleanup = () => { clearTimeout(timeout); notification.close(); disposers.delete(cleanup); };
        const timeout = setTimeout(cleanup, settings.store.toastSeconds * 1000);
        disposers.add(cleanup);
    } else showCard(body, entry.avatar, onClick);
    const sound = settings.store.sounds?.[event];
    if (sound && /^(https?:\/\/|data:audio\/)/i.test(sound)) {
        const audio = new Audio(sound);
        const cleanup = () => { audio.pause(); audio.src = ""; disposers.delete(cleanup); };
        disposers.add(cleanup); audio.onended = cleanup; audio.onerror = cleanup;
        void audio.play().catch(cleanup);
    }
}
function showCard(text: string, avatar?: string, onClick?: () => void) {
    host ??= document.createElement("div");
    Object.assign(host.style, { position: "fixed", bottom: "20px", [settings.store.position === "left" ? "left" : "right"]: "20px", zIndex: "2147483647", display: "flex", flexDirection: "column", gap: "8px", maxHeight: "80vh", overflow: "auto" });
    host.style[settings.store.position === "left" ? "right" : "left"] = "";
    if (!host.isConnected) document.body.append(host);
    const card = document.createElement("div");
    Object.assign(card.style, { display: "flex", gap: "12px", alignItems: "center", padding: "14px", width: "320px", borderRadius: "8px", background: "var(--background-surface-high, #292b2f)", color: "var(--text-default, #fff)", boxShadow: "0 4px 20px #0006", cursor: "pointer" });
    if (avatar) { const image = document.createElement("img"); image.src = avatar; image.width = image.height = 32; image.style.borderRadius = "50%"; card.append(image); }
    const body = document.createElement("span"); body.textContent = text; card.append(body);
    const close = document.createElement("button"); close.textContent = "x"; close.setAttribute("aria-label", "Dismiss notification"); card.append(close);
    const cleanup = () => { clearTimeout(timeout); card.remove(); disposers.delete(cleanup); };
    const timeout = setTimeout(cleanup, settings.store.toastSeconds * 1000);
    close.onclick = event => { event.stopPropagation(); cleanup(); };
    card.onclick = () => { onClick?.(); cleanup(); };
    host.append(card); disposers.add(cleanup);
}
function openHistory() {
    openModal(props => <Modal {...props} title="Friend notification history" size="lg"><History /></Modal>);
}
function History() {
    const entries = useHistory();
    const [query, setQuery] = useState("");
    return <div><input aria-label="Filter history" placeholder="Filter by user or message" value={query} onChange={event => setQuery(event.target.value)} /><Button onClick={() => { history.length = 0; emit(); }}>Clear history</Button><div style={{ maxHeight: "60vh", overflow: "auto" }}>{entries.filter(entry => `${entry.name} ${entry.text}`.toLowerCase().includes(query.toLowerCase())).map((entry, index) => <div key={`${entry.time}-${index}`} style={{ padding: "10px", borderBottom: "1px solid var(--background-modifier-accent)" }}><small>{new Date(entry.time).toLocaleString()} ? {entry.event}</small><div>{entry.text}</div><button onClick={() => openPrivateChannel(entry.id)}>Open DM</button></div>)}</div></div>;
}
function Counter() {
    const enabled = settings.use(["addOnlineCount"]).addOnlineCount;
    const count = useStateFromStores([PresenceStore, RelationshipStore], () => RelationshipStore.getFriendIDs().filter(id => PresenceStore.getStatus(id) !== "offline" && !!PresenceStore.getStatus(id)).length);
    return enabled ? <button title="Friend notification history" onClick={openHistory} style={{ width: "100%", padding: "10px 0", background: "none", border: 0, color: "var(--text-default)", cursor: "pointer" }}>{count} online</button> : null;
}
function Customization({ initialUserId = "" }: { initialUserId?: string; } = {}) {
    const state = settings.use(["rules", "templates", "sounds"]);
    const [id, setId] = useState(initialUserId);
    const [selected, select] = useState<Event>("online");
    const ids = [...userIds()];
    const rule = ruleFor(id);
    return <div style={{ display: "grid", gap: "12px" }}>
        <Paragraph>Desktop notifications fall back to toasts until permission is granted. History keeps the latest 500 changes for this session. Only presence already visible to Discord can be observed.</Paragraph>
        <Button onClick={openHistory}>Open history</Button>
        <Button onClick={() => { if (typeof Notification !== "undefined") void Notification.requestPermission().then(permission => showCard(`Desktop notification permission: ${permission}`)); }}>Allow desktop notifications</Button>
        <Button onClick={() => showCard("FriendNotifications test notification")}>Test toast</Button>
        <label>User rules <select aria-label="User to configure" value={id} onChange={event => setId(event.target.value)}><option value="">Select a user</option>{ids.map(userId => <option key={userId} value={userId}>{UserStore.getUser(userId)?.username ?? userId}</option>)}</select></label>
        {id && <div><label><input type="checkbox" checked={!!rule.disabled} onChange={event => setRule(id, { ...rule, disabled: event.target.checked })} />Ignore this user</label><label><input type="checkbox" checked={rule.history !== false} onChange={event => setRule(id, { ...rule, history: event.target.checked })} />Include in history</label>{events.map(event => <label key={event} style={{ display: "flex", justifyContent: "space-between" }}>{event}<select value={rule.modes?.[event] ?? "inherit"} onChange={e => { const modes = { ...rule.modes }; if (e.target.value === "inherit") delete modes[event]; else modes[event] = e.target.value as Mode; setRule(id, { ...rule, modes }); }}><option value="inherit">Use default</option><option value="off">Disabled</option><option value="toast">Toast</option><option value="desktop">Desktop</option></select></label>)}</div>}
        <label>Message and sound for <select value={selected} onChange={event => select(event.target.value as Event)}>{events.map(event => <option key={event}>{event}</option>)}</select></label>
        <Paragraph>Variables: $user, $nick, $status, $statusOld, $custom, $game, $song, $artist.</Paragraph>
        <input aria-label="Notification message template" value={state.templates?.[selected] ?? defaultTemplates[selected]} onChange={event => { settings.store.templates = { ...settings.store.templates, [selected]: event.target.value }; }} />
        <input aria-label="Notification sound URL" placeholder="Sound URL (https) or choose a local audio file" value={state.sounds?.[selected] ?? ""} onChange={event => { settings.store.sounds = { ...settings.store.sounds, [selected]: event.target.value }; }} />
        <input aria-label="Local notification sound" type="file" accept="audio/*" onChange={event => { const file = event.target.files?.[0]; if (!file || file.size > 2_000_000) return; const target = selected; const reader = new FileReader(); reader.onload = () => { settings.store.sounds = { ...settings.store.sounds, [target]: String(reader.result) }; }; reader.readAsDataURL(file); }} />
        <Button onClick={() => { settings.store.templates = { ...settings.store.templates, [selected]: defaultTemplates[selected] }; settings.store.sounds = { ...settings.store.sounds, [selected]: "" }; }}>Reset message and sound</Button>
    </div>;
}

export default definePlugin({
    name: "FriendNotifications",
    description: "Observe friends' status and activities with per-user rules, sounds, desktop notifications and history. Native port of DevilBro's plugin.",
    authors: [Devs.DevilBro],
    dependencies: ["ServerListAPI"], settings, startAt: StartAt.WebpackReady,
    contextMenus: {
        "user-context": (children, { user }) => {
            if (!user || user.id === UserStore.getCurrentUser()?.id) return;
            children.push(<Menu.MenuItem id="cutcord-friend-notifications" label="Friend notifications" action={() => {
                if (!userIds().has(user.id)) settings.store.extraUsers = `${settings.store.extraUsers} ${user.id}`.trim();
                openModal(props => <Modal {...props} title={`Notifications for ${user.username}`} size="lg"><Customization initialUserId={user.id} /></Modal>);
            }} />);
        }
    },
    flux: {
        CONNECTION_OPEN() { connected = true; baseline.clear(); scheduleCheck(); },
        CONNECTION_CLOSED() { connected = false; baseline.clear(); },
        LOGOUT() { connected = false; baseline.clear(); }
    },
    start() {
        running = true; connected = true; baseline.clear(); check(); restartPolling();
        for (const store of [PresenceStore, RelationshipStore, VoiceStateStore]) store.addChangeListener(scheduleCheck);
        addServerListElement(ServerListRenderPosition.In, Counter);
    },
    stop() {
        running = false; clearInterval(timer); clearTimeout(debounce); baseline.clear();
        for (const store of [PresenceStore, RelationshipStore, VoiceStateStore]) store.removeChangeListener(scheduleCheck);
        removeServerListElement(ServerListRenderPosition.In, Counter);
        for (const cleanup of [...disposers]) cleanup();
        host?.remove(); host = undefined;
    }
});
