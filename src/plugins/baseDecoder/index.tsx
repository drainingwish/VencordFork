/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import type { MessagePopoverButtonItem } from "@api/MessagePopover";
import { definePluginSettings } from "@api/Settings";
import { CodeBlock } from "@components/CodeBlock";
import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { EquicordDevs } from "@utils/constants";
import { copyWithToast } from "@utils/discord";
import definePlugin, { IconProps, OptionType } from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { ChannelStore, Modal, openModal } from "@webpack/common";

import { decodeBase64Strings, findBase64Strings } from "./decode";

function DecodeIcon(props: IconProps) {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
            <path d="M6.5 9.50026H14.0385C15.4063 9.50026 16.0902 9.50026 16.5859 9.82073C16.8235 9.97438 17.0259 10.1767 17.1795 10.4144C17.5 10.91 17.5 11.5939 17.5 12.9618C17.5 14.3297 17.5 15.0136 17.1795 15.5092C17.0259 15.7469 16.8235 15.9492 16.5859 16.1029C16.0902 16.4233 15.4063 16.4233 14.0385 16.4233H9.5M6.5 9.50026L8.75 7.42334M6.5 9.50026L8.75 11.5772" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function openDecodedBase64Modal(decodedContent: readonly string[]): void {
    openModal(props => (
        <ErrorBoundary>
            <Modal
                {...props}
                size="lg"
                title="Decoded Base64 Content"
                actions={decodedContent.map((content, index) => ({
                    text: `Copy Decoded Content ${index + 1}`,
                    variant: "primary",
                    onClick: () => copyWithToast(content, "Decoded content copied to clipboard!")
                }))}
            >
                <div style={{ padding: "16px 0" }}>
                    <Heading>Decoded Content</Heading>
                    {decodedContent.map((content, index) => (
                        <CodeBlock key={index} content={content} lang="" />
                    ))}
                </div>
            </Modal>
        </ErrorBoundary>
    ));
}

const settings = definePluginSettings({
    clickMethod: {
        description: "Choose which mouse button opens the decoded content. The other button copies it.",
        type: OptionType.SELECT,
        options: [
            { label: "Left click to decode", value: "Left", default: true },
            { label: "Right click to decode", value: "Right" }
        ]
    }
});

export default definePlugin({
    name: "DecodeBase64",
    description: "Decode Base64 text in messages and copy the decoded content.",
    dependencies: ["MessagePopoverAPI"],
    tags: ["Appearance", "Customisation", "Chat"],
    authors: [EquicordDevs.ThePirateStoner],
    settings,
    messagePopoverButton: {
        icon: DecodeIcon,
        render(message: Message): MessagePopoverButtonItem | null {
            const channel = ChannelStore.getChannel(message.channel_id);
            const decodedContent = decodeBase64Strings(findBase64Strings(message.content));
            if (!channel || !decodedContent.length) return null;

            const copyDecodedContent = () => copyWithToast(decodedContent.join("\n\n"), "Decoded content copied to clipboard!");
            const openDecodedContent = () => openDecodedBase64Modal(decodedContent);
            const decodeOnLeftClick = settings.store.clickMethod === "Left";

            return {
                label: decodeOnLeftClick
                    ? "Decode Base64 (Left Click) / Copy Decoded (Right Click)"
                    : "Copy Decoded (Left Click) / Decode Base64 (Right Click)",
                icon: DecodeIcon,
                message,
                channel,
                onClick: decodeOnLeftClick ? openDecodedContent : copyDecodedContent,
                onContextMenu(event) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (decodeOnLeftClick) copyDecodedContent();
                    else openDecodedContent();
                }
            };
        }
    }
});
