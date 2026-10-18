/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*! Acorn 8.17.0
 * MIT License
 *
 * Copyright (C) 2012-2022 by various contributors (see AUTHORS)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 */

import { parseExpressionAt } from "acorn";

import { captureRules } from "./captureRules";

export const declarations = new Map<string, Record<string, unknown>>();
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const captureFind = new RegExp("^(?:" + captureRules.map(rule => rule.map(text => `(?=[\\s\\S]*${escaped(text)})`).join("")).join("|") + ")");

export function captureDeclarations(id: string | number, descriptors: PropertyDescriptorMap): void {
    declarations.set(String(id), Object.defineProperties({}, descriptors));
}

export function instrumentFactory(source: string): string {
    const expression = parseExpressionAt(source, 0, { ecmaVersion: "latest" }) as any;
    const factory = expression.type === "SequenceExpression" ? expression.expressions.at(-1) : expression;
    if (!factory || !["FunctionExpression", "ArrowFunctionExpression"].includes(factory.type) || factory.body.type !== "BlockStatement") return source;
    const names = new Set<string>();
    const edits: { position: number; remove: number; value: string; }[] = [];
    function collect(pattern: any): void {
        if (!pattern) return;
        if (pattern.type === "Identifier") names.add(pattern.name);
        else if (pattern.type === "ObjectPattern") pattern.properties.forEach((property: any) => collect(property.value ?? property.argument));
        else if (pattern.type === "ArrayPattern") pattern.elements.forEach(collect);
        else if (pattern.type === "AssignmentPattern") collect(pattern.left);
        else if (pattern.type === "RestElement") collect(pattern.argument);
    }
    for (const statement of factory.body.body) {
        if (statement.type === "VariableDeclaration") {
            statement.declarations.forEach((declaration: any) => collect(declaration.id));
            if (statement.kind === "const") edits.push({ position: statement.start, remove: 5, value: "let" });
        } else if (["FunctionDeclaration", "ClassDeclaration"].includes(statement.type) && statement.id) collect(statement.id);
    }
    let moduleName = factory.params[0]?.name;
    if (!moduleName && !factory.params.length) {
        moduleName = "__baModule";
        const opening = source.indexOf("(", factory.start);
        edits.push({ position: opening + 1, remove: 0, value: moduleName });
    }
    if (!moduleName || !names.size) return source;
    const descriptors = [...names].map(name => `${JSON.stringify(name)}:{configurable:true,enumerable:true,get:()=>${name},set:__baValue=>${name}=__baValue}`).join(",");
    let position = factory.body.start + 1;
    for (const statement of factory.body.body) {
        if (!statement.directive) break;
        position = statement.end;
    }
    edits.push({ position, remove: 0, value: `;$self.captureDeclarations(${moduleName}.id,{${descriptors}});` });
    for (const edit of edits.sort((a, b) => b.position - a.position)) source = source.slice(0, edit.position) + edit.value + source.slice(edit.position + edit.remove);
    return source;
}
