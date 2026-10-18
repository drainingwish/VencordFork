/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import type { PluginNative } from "@utils/types";
import { Modal, openModal, useState } from "@webpack/common";

const native = VencordNative.pluginHelpers.BetterAnimations as PluginNative<typeof import("./native")>;
const example = JSON.stringify({ name: "Custom", author: "Your name", version: "1.0.0", description: "My animation pack", animations: [] }, null, 4);
interface Props { validate(text: string): string | null; }

export function openPackEditor(validate: Props["validate"]) {
    openModal(props => <Modal {...props} title="Animation pack editor" size="lg"><PackEditor validate={validate} /></Modal>);
}
function PackEditor({ validate }: Props) {
    const [filename, setFilename] = useState("custom.pack.json");
    const [text, setText] = useState(example);
    const [message, setMessage] = useState("");
    const [files, setFiles] = useState(() => (native.syncFs("list", "") as string[]).filter(name => name.endsWith(".pack.json")));
    const [selected, setSelected] = useState("");
    function save() {
        const error = validate(text);
        if (error) { setMessage(error); return; }
        if (!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]*\.pack\.json$/.test(filename)) { setMessage("Use a filename ending in .pack.json, without folder separators."); return; }
        if (files.includes(filename) && selected !== filename) { setMessage("A pack already uses that filename. Open it before replacing it."); return; }
        try {
            native.syncFs("write", filename, text);
            setSelected(filename);
            setFiles((native.syncFs("list", "") as string[]).filter(name => name.endsWith(".pack.json")));
            setMessage("Saved. The animation library will reload this pack automatically. Its existing trust checks still apply.");
        } catch (error) { setMessage(String(error)); }
    }
    function download() {
        const blob = new Blob([text], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return <div style={{ display: "grid", gap: "12px" }}>
        <Paragraph>Create, import, edit, validate and export complete animation packs as JSON. All animation definitions, settings and snippets are preserved.</Paragraph>
        <label>Open a local pack <select aria-label="Local animation pack" value={selected} onChange={event => {
            const name = event.target.value; if (!name) return;
            try { setText(String(native.syncFs("read", name))); setFilename(name); setSelected(name); setMessage(""); }
            catch (error) { setMessage(String(error)); }
        }}><option value="">Choose a pack</option>{files.map(name => <option key={name}>{name}</option>)}</select></label>
        <input aria-label="Import animation pack" type="file" accept=".json,application/json" onChange={event => {
            const file = event.target.files?.[0]; if (!file) return;
            void file.text().then(value => { setText(value); setFilename(file.name.endsWith(".pack.json") ? file.name : file.name.replace(/\.json$/, "") + ".pack.json"); setSelected(""); setMessage(""); }).catch(error => setMessage(String(error)));
        }} />
        <input aria-label="Animation pack filename" value={filename} onChange={event => setFilename(event.target.value)} />
        <textarea aria-label="Animation pack JSON" spellCheck={false} value={text} onChange={event => setText(event.target.value)} style={{ minHeight: "380px", resize: "vertical", width: "100%", boxSizing: "border-box", fontFamily: "monospace", whiteSpace: "pre", tabSize: 4 }} />
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Button onClick={save}>Save pack</Button>
            <Button onClick={() => setMessage(validate(text) ?? "Valid animation pack")}>Validate</Button>
            <Button onClick={() => { try { setText(JSON.stringify(JSON.parse(text), null, 4)); setMessage(""); } catch (error) { setMessage(String(error)); } }}>Format JSON</Button>
            <Button onClick={download}>Export JSON</Button>
            <Button onClick={() => { setText(example); setFilename("custom.pack.json"); setSelected(""); setMessage(""); }}>New pack</Button>
        </div>
        <pre role="status" style={{ whiteSpace: "pre-wrap", maxHeight: "160px", overflow: "auto" }}>{message}</pre>
    </div>;
}
