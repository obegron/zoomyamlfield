import * as vscode from 'vscode';
import * as jsYaml from 'js-yaml';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let zoomedEditor: vscode.TextEditor | undefined;
let originalEditor: vscode.TextEditor | undefined;
let yamlPath: string | undefined;
let tempFilePath: string | undefined;
let isUpdating = false;
let eol: string | "\n";
let debugLogging: boolean;
let outputChannel: vscode.OutputChannel;
let zoomStatusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel("YAML Field Editor");
    outputChannel.show();
    zoomStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    zoomStatusBarItem.hide();
    debugLogging = vscode.workspace.getConfiguration('yamlFieldEditor').get('enableDebugLogging', false);
    debugLog("Extension activated");

    const zoomYamlFieldDisposable = vscode.commands.registerCommand('extension.zoomYamlField', zoomYamlField);
    const activateYamlKeyDisposable = vscode.commands.registerCommand('extension.activateYamlKey', activateYamlKey);

    context.subscriptions.push(zoomYamlFieldDisposable, activateYamlKeyDisposable, zoomStatusBarItem);
    vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('yamlFieldEditor.enableDebugLogging')) {
            debugLogging = vscode.workspace.getConfiguration('yamlFieldEditor').get('enableDebugLogging', false);
            debugLog(`Debug logging ${debugLogging ? 'enabled' : 'disabled'}`);
        }
    });
}

function debugLog(message: string) {
    if (debugLogging) {
        outputChannel.appendLine(`[DEBUG] ${message}`);
    }
}

export function deactivate() {
    if (tempFilePath) {
        try {
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
        } catch (error) {
            debugLog(`Error deleting temp file: ${error}`);
        }
    }
    zoomedEditor = undefined;
    yamlPath = undefined;
    tempFilePath = undefined;
    zoomStatusBarItem.hide();
}

// Command implementations
async function zoomYamlField() {
    originalEditor = vscode.window.activeTextEditor;
    if (!originalEditor) {
        vscode.window.showErrorMessage('No active editor!');
        return;
    }
    debugLog(`Original editor document: ${originalEditor.document.uri.toString()}`);
    debugLog(`yamlPath ${yamlPath}`);

    if (!yamlPath) return;

    const document = originalEditor.document;
    const yamlContent = document.getText();
    eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';

    try {
        const parsedYaml = jsYaml.load(yamlContent) as any;
        const fieldValue = getNestedValue(parsedYaml, yamlPath);

        if (fieldValue === undefined) {
            throw new Error('Field not found in YAML ' + yamlPath);
        }

        const stringValue = convertToString(fieldValue);
        const detectedLanguage = await detectLanguage(stringValue);

        const cursorPosition = originalEditor.selection.active;
        const currentLine = document.lineAt(cursorPosition.line).text;

        const zoomedLineNumber = findCorrespondingLine(currentLine, stringValue);

        const langExtensions: { [key: string]: string } = {
            'shellscript': 'sh',
            'python': 'py',
            'javascript': 'js',
            'powershell': 'ps1',
            'plaintext': 'txt'
        };
        const extension = langExtensions[detectedLanguage] || 'txt';
        const tempDir = os.tmpdir();
        const newTempFilePath = path.join(tempDir, `zoomed-yaml-${Date.now()}.${extension}`);
        tempFilePath = newTempFilePath;
        const fileContent = stringValue;
        fs.writeFileSync(newTempFilePath, fileContent);

        const newDocument = await vscode.workspace.openTextDocument(newTempFilePath);

        zoomedEditor = await vscode.window.showTextDocument(newDocument, vscode.ViewColumn.Beside);
        
        debugLog(`zoomedLineNumber ${zoomedLineNumber}`);

        // Scroll to the corresponding line in the zoomed editor
        if (zoomedLineNumber !== -1) {
            const position = new vscode.Position(zoomedLineNumber, 0);
            zoomedEditor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            zoomedEditor.selection = new vscode.Selection(position, position);
        }

        showZoomStatus(yamlPath);

        setupCloseHandler(newDocument);
        setupEditHandler(newDocument);

    } catch (error) {
        handleError(error,'zoomYamlField');
    }
    
}

function findCorrespondingLine(currentLine: string, zoomedContent: string): number {
    const lines = zoomedContent.split(/\r?\n/);
    let data = currentLine.trim();

    if (data.startsWith('- ')) {
        data = data.substring(2).trim();
    }
    if (data.includes(':')) {
        data = data.substring(data.indexOf(':') + 1).trim();
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        debugLog(`${i}:  ${line}`);
        if (line.includes(data)) {
            return i;
        }
    }

    return -1;
}



function setupEditHandler(document: vscode.TextDocument) {
    return vscode.workspace.onDidChangeTextDocument(async (e) => {
        if (e.document === document && !isUpdating) {
            isUpdating = true;
            await updateOriginalYaml();
            if (zoomedEditor && zoomedEditor.document === document && !zoomedEditor.document.isClosed) {
                await zoomedEditor.document.save();
            }
            isUpdating = false;
        }
    });
}

async function activateYamlKey() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor!');
        return;
    }

    const document = editor.document;
    const selection = editor.selection;
    const cursorPosition = selection.active;

    try {
        const yamlContent = document.getText();
        const parsedYaml = jsYaml.load(yamlContent) as any;

        const lineText = document.lineAt(cursorPosition.line).text;

        if (lineText) {
            let data = lineText.trim();
            debugLog(`Trying to determine path from cursor at line ${cursorPosition.line}, char ${cursorPosition.character}`);
            let path = getYamlPathAtCursor(yamlContent, cursorPosition);
            debugLog(`Path found from cursor: ${path ?? 'none'}`);
            if(!path){
                debugLog(`Falling back to value search for line value '${data}'`);
                path = getYamlPath(parsedYaml, data);
            }
            if(!path){
                if(data.startsWith("- ")){
                    data = data = data.substring(2).trim();
                    debugLog(`trying to find array field containing value '${data}'`);
                    path = getYamlPath(parsedYaml,data);
                }
                if(data.includes(":")){
                    data  = data.substring(data.indexOf(':') + 1).trim();
                    debugLog(`trying to find single line field containing value '${data}'`);
                    path = getYamlPath(parsedYaml,data);
                }                
            }

            if (path) {
                const value = getNestedValue(parsedYaml, path);
                if (value !== undefined) {
                    yamlPath = path;  // Set the yamlPath for future use
                    vscode.window.showInformationMessage(`Activated key: ${path}, Value: ${JSON.stringify(value)}`);
                    await vscode.commands.executeCommand('extension.zoomYamlField');
                } else {
                    vscode.window.showWarningMessage(`Key "${path}" not found in YAML structure.`);
                }
            } else {
                vscode.window.showWarningMessage(`Could not determine path for value "${data}".`);
            }
        }
    } catch (error) {
        handleError(error,'activateYamlKey');
    }
}

// Helper functions
function convertToString(value: any): string {
    if (typeof value === 'string') {
        return value;
    } else if (typeof value === 'object') {
        return jsYaml.dump(value);
    }
    else {
        return String(value);
    }
}

function showZoomStatus(path: string) {
    zoomStatusBarItem.text = `$(search-view-icon) YAML Zoom: ${path}`;
    zoomStatusBarItem.tooltip = `Editing YAML path ${path}`;
    zoomStatusBarItem.show();
}

function setupCloseHandler(document: vscode.TextDocument) {
    return vscode.workspace.onDidCloseTextDocument(async (closedDoc) => {
        if (closedDoc === document) {
            if (tempFilePath) {
                try {
                    if (fs.existsSync(tempFilePath)) {
                        fs.unlinkSync(tempFilePath);
                    }
                } catch (error) {
                    handleError(error, "unlink temp file");
                }
                tempFilePath = undefined;
            }
            zoomedEditor = undefined;
            yamlPath = undefined;
            zoomStatusBarItem.hide();
        }
    });
}

async function updateOriginalYaml() {
    if (!zoomedEditor || !originalEditor || !yamlPath) return;

    const zoomedContent = zoomedEditor.document.getText();
    const yamlContent = originalEditor.document.getText();

    if (!zoomedContent) return;

    try {
        const parsedYaml = jsYaml.load(yamlContent, { schema: jsYaml.DEFAULT_SCHEMA }) as any;

        const fieldValue = zoomedContent;

        // Update the value in the parsed YAML
        setNestedValue(parsedYaml, yamlPath, fieldValue);

        // Convert the updated YAML back to a string
        let updatedYaml = jsYaml.dump(parsedYaml, {
            noRefs: true,
            lineWidth: -1,
            forceQuotes: false,
            quotingType: '"',
            styles: {
                '!!null': 'canonical', // dump null as ~
                '!!int': 'decimal',
                '!!bool': 'lowercase',
                '!!float': 'lowercase',
                '!!map': 'block',
                '!!seq': 'block',
                '!!str': 'literal'
            }
        });

        // Apply the edit
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            originalEditor.document.uri,
            new vscode.Range(0, 0, originalEditor.document.lineCount, 0),
            updatedYaml
        );

        await vscode.workspace.applyEdit(edit);
    } catch (error) {
        handleError(error,"updateOriginalYaml");
    }
}

function handleError(error: unknown, context: string) {
    if (error instanceof Error) {
        debugLog(`Error in ${context}: ${error.message}`);
        debugLog(error.stack || "No stack trace available");
        vscode.window.showErrorMessage(`Error in ${context}: ${error.message}`);
    } else {
        debugLog(`An unexpected error occurred in ${context}: ${String(error)}`);
        vscode.window.showErrorMessage(`An unexpected error occurred in ${context}`);
    }
}


function getYamlPath(obj: any, data: string): string | undefined {
    function traverse(current: any, path: string[] = []): string | undefined {
        if (typeof current !== 'object' || current === null) {
            return undefined;
        }

        for (const [key, value] of Object.entries(current)) {
            const currentPath = [...path, key];
            
            if (typeof value === 'object' && value !== null) {
                const result = traverse(value, currentPath);
                if (result) return result;
            } else if (typeof value === 'string' && value.includes(data)) {
                    return formatYamlPath(currentPath);
            }            
        }
        return undefined;
    }
    return traverse(obj);
}

function getNestedValue(obj: any, path: string): any {
    const parts = parseYamlPath(path);
    let current = obj;

    for (const part of parts) {
        if (current === undefined || current === null) {
            return undefined;
        }

        if (Array.isArray(current)) {
            const index = parseInt(part, 10);
            if (isNaN(index)) {
                return undefined;
            }
            current = current[index];
        } else if (typeof current === 'object') {
            current = current[part];
        } else {
            return undefined;
        }
    }

    return current;
}

function setNestedValue(obj: any, path: string, value: string): void {
    debugLog(`${eol}Setting nested value for path: ${path}`);
    debugLog(`Value to set: ${value}`);

    const parts = parseYamlPath(path);
    if (parts.length === 0) {
        throw new Error('Cannot set an empty YAML path');
    }

    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const nextPart = parts[i + 1];

        if (Array.isArray(current)) {
            const index = parseArrayIndex(part);
            if (index === undefined) {
                throw new Error(`Expected array index at "${part}" in path "${path}"`);
            }
            if (current[index] === undefined) {
                current[index] = isArrayIndex(nextPart) ? [] : {};
            }
            current = current[index];
            continue;
        }

        if (typeof current !== 'object' || current === null) {
            throw new Error(`Cannot descend into non-object value at "${part}" in path "${path}"`);
        }

        if (!(part in current) || current[part] === undefined) {
            current[part] = isArrayIndex(nextPart) ? [] : {};
        }

        current = current[part];
    }

    const lastPart = parts[parts.length - 1];
    if (Array.isArray(current)) {
        const index = parseArrayIndex(lastPart);
        if (index === undefined) {
            throw new Error(`Expected array index at "${lastPart}" in path "${path}"`);
        }
        current[index] = value;
    } else {
        if (typeof current !== 'object' || current === null) {
            throw new Error(`Cannot set value on non-object path "${path}"`);
        }
        current[lastPart] = value;
    }

    debugLog("Nested value set");
}

function needsQuotedPathSegment(segment: string): boolean {
    return segment.length === 0 || /[.\s"\\]/.test(segment);
}

function formatYamlPath(parts: string[]): string {
    return parts
        .map(part => needsQuotedPathSegment(part)
            ? `"${part.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
            : part)
        .join('.');
}

function parseYamlPath(path: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inQuotes = false;
    let escaping = false;

    for (const char of path) {
        if (escaping) {
            current += char;
            escaping = false;
            continue;
        }

        if (inQuotes) {
            if (char === '\\') {
                escaping = true;
            } else if (char === '"') {
                inQuotes = false;
            } else {
                current += char;
            }
            continue;
        }

        if (char === '"') {
            inQuotes = true;
            continue;
        }

        if (char === '.') {
            parts.push(current);
            current = '';
            continue;
        }

        current += char;
    }

    if (escaping || inQuotes) {
        throw new Error(`Invalid YAML path: ${path}`);
    }

    parts.push(current);
    return parts.filter((part, index) => !(index === 0 && part === ''));
}

function isArrayIndex(value: string): boolean {
    return parseArrayIndex(value) !== undefined;
}

function parseArrayIndex(value: string): number | undefined {
    if (!/^\d+$/.test(value)) {
        return undefined;
    }

    return Number(value);
}

export const __testing = {
    formatYamlPath,
    parseYamlPath,
    getNestedValue,
    setNestedValue
};

async function detectLanguage(content: string): Promise<string> {
    // Check for known shebangs or language markers
    if (content.startsWith('#!/bin/bash') || content.includes('#!/usr/bin/env bash') ||
        content.startsWith('#!/bin/sh') || content.includes('#!/usr/bin/env sh')) {
        return 'shellscript';
    }
    if (content.startsWith('#!/usr/bin/env python') || content.startsWith('#!/bin/python') || 
        content.startsWith('#!/usr/libexec/platform-python')) {
        return 'python';
    }
    if (content.startsWith('#!/usr/bin/env node') || content.includes('#!/bin/node')) {
        return 'javascript';
    }
    if (content.startsWith('#!/usr/bin/env pwsh')) {
        return 'powershell';
    }
    return 'plaintext';
}

function getYamlPathAtCursor(yamlContent: string, cursor: vscode.Position): string | undefined {
    let doc: any;
    try {
        doc = parseDocument(yamlContent);
    } catch (error) {
        debugLog(`YAML parse error while resolving cursor path: ${String(error)}`);
        return undefined;
    }

    if (!doc.contents) {
        return undefined;
    }

    const offset = getOffsetFromPosition(yamlContent, cursor);
    const result = findPathForNodeAtOffset(doc.contents, offset, []);
    return result ? formatYamlPath(result) : undefined;
}

function getOffsetFromPosition(text: string, position: vscode.Position): number {
    const lines = text.split(/\r?\n/);
    let offset = 0;

    for (let i = 0; i < position.line && i < lines.length; i++) {
        offset += lines[i].length + 1;
    }

    return offset + position.character;
}

function findPathForNodeAtOffset(node: unknown, offset: number, path: string[]): string[] | undefined {
    if (!node || typeof node !== 'object' || !('range' in node)) {
        return undefined;
    }

    const range = (node as { range?: [number, number, number?] }).range;
    if (!range) {
        return undefined;
    }

    const [start, end] = range;
    if (offset < start || offset > end) {
        return undefined;
    }

    if (isMap(node)) {
        for (const item of node.items) {
            if (!item.key || !isScalar(item.key)) {
                continue;
            }

            const keyText = String(item.key.value);
            const keyRange = (item.key as { range?: [number, number, number?] }).range;
            if (keyRange && offset >= keyRange[0] && offset <= keyRange[1]) {
                return [...path, keyText];
            }

            if (!item.value) {
                continue;
            }

            const nested = findPathForNodeAtOffset(item.value, offset, [...path, keyText]);
            if (nested) {
                return nested;
            }
        }
    }

    if (isSeq(node)) {
        for (let i = 0; i < node.items.length; i++) {
            const item = node.items[i];
            const nested = findPathForNodeAtOffset(item, offset, [...path, String(i)]);
            if (nested) {
                return nested;
            }
        }
    }

    return path;
}
