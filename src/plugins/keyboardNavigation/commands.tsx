/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { Settings } from "@api/Settings";
import { gitHashShort } from "@shared/vencordUserAgent";
import { copyToClipboard } from "@utils/clipboard";
import { relaunch } from "@utils/native";
import { checkForUpdates, getRepo } from "@utils/updater";
import { GuildStore, NavigationRouter, SettingsRouter, Toasts } from "@webpack/common";

import gitRemote from "~git-remote";
import Plugins from "~plugins";

import { openMultipleChoice } from "./components/MultipleChoice";
import { openSimpleTextInput } from "./components/TextInput";

export interface ButtonAction {
    id: string;
    label: string;
    callback?: () => void;
    registrar?: string;
}

export const actions: ButtonAction[] = [
    { id: "openEquicordSettings", label: "Open Cutcord tab", callback: async () => await SettingsRouter.openUserSettings("vencord_main_panel"), registrar: "Cutcord" },
    { id: "openPluginSettings", label: "Open Plugin tab", callback: () => SettingsRouter.openUserSettings("vencord_plugins_panel"), registrar: "Cutcord" },
    { id: "openThemesSettings", label: "Open Themes tab", callback: () => SettingsRouter.openUserSettings("vencord_themes_panel"), registrar: "Cutcord" },
    { id: "openUpdaterSettings", label: "Open Updater tab", callback: () => SettingsRouter.openUserSettings("vencord_updater_panel"), registrar: "Cutcord" },
    { id: "openEquicordCloudSettings", label: "Open Cloud tab", callback: () => SettingsRouter.openUserSettings("vencord_cloud_panel"), registrar: "Cutcord" },
    { id: "openBackupSettings", label: "Open Backup & Restore tab", callback: () => SettingsRouter.openUserSettings("vencord_backup_restore_panel"), registrar: "Cutcord" },
    { id: "restartClient", label: "Restart Client", callback: () => relaunch(), registrar: "Cutcord" },
    { id: "openQuickCSSFile", label: "Open Quick CSS File", callback: () => VencordNative.quickCss.openEditor(), registrar: "Cutcord" },
    { id: "openSettingsFolder", label: "Open Settings Folder", callback: async () => VencordNative.settings.openFolder(), registrar: "Cutcord" },
    { id: "openInGithub", label: "Open in Github", callback: async () => VencordNative.native.openExternal(await getRepo()), registrar: "Cutcord" },

    {
        id: "openInBrowser", label: "Open in Browser", callback: async () => {
            const url = await openSimpleTextInput("Enter a URL");
            const newUrl = url.replace(/(https?:\/\/)?([a-zA-Z0-9-]+)\.([a-zA-Z0-9-]+)/, "https://$2.$3");

            try {
                new URL(newUrl); // Throws if invalid
                VencordNative.native.openExternal(newUrl);
            } catch {
                Toasts.show({
                    message: "Invalid URL",
                    type: Toasts.Type.FAILURE,
                    id: Toasts.genId(),
                    options: {
                        position: Toasts.Position.BOTTOM
                    }
                });
            }
        }, registrar: "Cutcord"
    },

    {
        id: "togglePlugin", label: "Toggle Plugin", callback: async () => {
            const plugins = Object.keys(Plugins);
            const options: ButtonAction[] = [];

            for (const plugin of plugins) {
                options.push({
                    id: plugin,
                    label: plugin
                });
            }

            const choice = await openMultipleChoice(options);

            const enabled = await openMultipleChoice([
                { id: "enable", label: "Enable" },
                { id: "disable", label: "Disable" }
            ]);

            if (choice && enabled) {
                return togglePlugin(choice, enabled.id === "enable");
            }
        }, registrar: "Cutcord"
    },

    {
        id: "quickFetch", label: "Quick Fetch", callback: async () => {
            try {
                const url = await openSimpleTextInput("Enter URL to fetch (GET only)");
                const newUrl = url.replace(/(https?:\/\/)?([a-zA-Z0-9-]+)\.([a-zA-Z0-9-]+)/, "https://$2.$3");
                const res = (await fetch(newUrl));
                const text = await res.text();
                copyToClipboard(text);

                Toasts.show({
                    message: "Copied response to clipboard!",
                    type: Toasts.Type.SUCCESS,
                    id: Toasts.genId(),
                    options: {
                        position: Toasts.Position.BOTTOM
                    }
                });

            } catch (e) {
                Toasts.show({
                    message: "Issue fetching URL",
                    type: Toasts.Type.FAILURE,
                    id: Toasts.genId(),
                    options: {
                        position: Toasts.Position.BOTTOM
                    }
                });
            }
        }, registrar: "Cutcord"
    },

    {
        id: "copyGitInfo", label: "Copy Git Info", callback: async () => {
            copyToClipboard(`gitHash: ${gitHashShort}\ngitRemote: ${gitRemote}`);

            Toasts.show({
                message: "Copied git info to clipboard!",
                type: Toasts.Type.SUCCESS,
                id: Toasts.genId(),
                options: {
                    position: Toasts.Position.BOTTOM
                }
            });
        }, registrar: "Cutcord"
    },

    {
        id: "checkForUpdates", label: "Check for Updates", callback: async () => {
            const isOutdated = await checkForUpdates();

            if (isOutdated) {
                setTimeout(() => showNotification({
                    title: "A Cutcord update is available!",
                    body: "Click here to view the update",
                    permanent: true,
                    noPersist: true,
                    onClick() {
                        SettingsRouter.openUserSettings("vencord_updater_panel");
                    }
                }), 10_000);
            } else {
                Toasts.show({
                    message: "No updates available",
                    type: Toasts.Type.MESSAGE,
                    id: Toasts.genId(),
                    options: {
                        position: Toasts.Position.BOTTOM
                    }
                });
            }
        }, registrar: "Cutcord"
    },

    {
        id: "navToServer", label: "Navigate to Server", callback: async () => {
            const allServers = Object.values(GuildStore.getGuilds());
            const options: ButtonAction[] = [];

            for (const server of allServers) {
                options.push({
                    id: server.id,
                    label: server.name
                });
            }

            const choice = await openMultipleChoice(options);

            if (choice) {
                NavigationRouter.transitionToGuild(choice.id);
            }
        }, registrar: "Cutcord"
    }
];

function togglePlugin(plugin: ButtonAction, enabled: boolean) {

    Settings.plugins[plugin.id].enabled = enabled;

    Toasts.show({
        message: `Successfully ${enabled ? "enabled" : "disabled"} ${plugin.id}`,
        type: Toasts.Type.SUCCESS,
        id: Toasts.genId(),
        options: {
            position: Toasts.Position.BOTTOM
        }
    });
}

export function registerAction(action: ButtonAction) {
    actions.push(action);
}
