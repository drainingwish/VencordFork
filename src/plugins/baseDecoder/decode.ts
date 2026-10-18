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

export function findBase64Strings(content: string): string[] {
    return content.match(/(?<![A-Za-z0-9+/=])(?:[A-Za-z0-9+/]{4,}={0,2}|[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)(?![A-Za-z0-9+/=])/g) ?? [];
}

export function decodeBase64Strings(base64Strings: readonly string[]): string[] {
    return base64Strings.map(base64 => {
        try {
            const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
            return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
            return null;
        }
    }).filter((decoded): decoded is string => decoded !== null);
}
