import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

let zoomedEditor: vscode.TextEditor | undefined;
let originalEditor: vscode.TextEditor | undefined;
let yamlPath: string | undefined;
let isUpdating = false;
let eol: string | "\n";
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel("YAML Field Editor");
    outputChannel.show();
    outputChannel.appendLine("Extension activated");

    const zoomYamlFieldDisposable = vscode.commands.registerCommand('extension.zoomYamlField', zoomYamlField);
    const activateYamlKeyDisposable = vscode.commands.registerCommand('extension.activateYamlKey', activateYamlKey);

    context.subscriptions.push(zoomYamlFieldDisposable, activateYamlKeyDisposable);
}

export function deactivate() {
    zoomedEditor = undefined;
    yamlPath = undefined;
}

// Command implementations
async function zoomYamlField() {
    originalEditor = vscode.window.activeTextEditor;
    if (!originalEditor) {
        vscode.window.showErrorMessage('No active editor!');
        return;
    }

    outputChannel.appendLine(`yamlPath ${yamlPath}`);

    if (!yamlPath) return;

    if (!yamlPath.startsWith('.')) {
        yamlPath = '.' + yamlPath;
    }

    const document = originalEditor.document;
    const yamlContent = document.getText();
    eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';

    try {
        const parsedYaml = yaml.load(yamlContent) as any;
        const fieldValue = getNestedValue(parsedYaml, yamlPath);

        if (fieldValue === undefined) {
            throw new Error('Field not found in YAML ' + yamlPath);
        }

        const stringValue = convertToString(fieldValue);
        const detectedLanguage = await detectLanguage(stringValue);

        const cursorPosition = originalEditor.selection.active;
        const currentLine = document.lineAt(cursorPosition.line).text;

        const zoomedLineNumber = findCorrespondingLine(currentLine, stringValue);

        const newDocument = await vscode.workspace.openTextDocument({
            content: `# YAML Path: ${yamlPath}${eol}${eol}${stringValue}`,
            language: detectedLanguage
        });

        zoomedEditor = await vscode.window.showTextDocument(newDocument, vscode.ViewColumn.Beside);
        
        outputChannel.appendLine(`zoomedLineNumber ${zoomedLineNumber}`);

        // Scroll to the corresponding line in the zoomed editor + 2 because of header we add
        if (zoomedLineNumber !== -1) {
            const position = new vscode.Position(zoomedLineNumber + 2, 0);
            zoomedEditor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            zoomedEditor.selection = new vscode.Selection(position, position);
        }


        highlightYamlPath(zoomedEditor, yamlPath);

        setupChangeHandler(newDocument);
        setupCloseHandler(newDocument);
        setupEditHandler(newDocument);

    } catch (error) {
        handleError(error);
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
    outputChannel.appendLine(`looking for ${data}`);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        outputChannel.appendLine(`${i}:  ${line}`);
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
        const parsedYaml = yaml.load(yamlContent) as any;

        const lineText = document.lineAt(cursorPosition.line).text;        

        if (lineText) {
            let data = lineText.trim();
            outputChannel.appendLine(`trying to find key for value containing value  ${lineText}`)
            let path = getYamlPath(parsedYaml, data);
            if(!path){
                if(data.startsWith("- ")){
                    data = data = data.substring(2).trim();
                    outputChannel.appendLine(`trying to find array field containing value '${data}'`);
                    path = getYamlPath(parsedYaml,data);
                }
                if(data.includes(":")){
                    data  = data.substring(data.indexOf(':') + 1).trim();
                    outputChannel.appendLine(`trying to find single line field containing value '${data}'`);
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
        handleError(error);
    }
}

// Helper functions
function convertToString(value: any): string {
    if (typeof value === 'string') {
        return value;
    } else if (typeof value === 'object') {
        return yaml.dump(value);
    } else {
        return String(value);
    }
}

function highlightYamlPath(editor: vscode.TextEditor, path: string) {
    const range = new vscode.Range(0, 0, 0, path.length + 13);
    editor.setDecorations(vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.lineHighlightBackground'),
        isWholeLine: true,
    }), [range]);
}

function setupChangeHandler(document: vscode.TextDocument) {
    return vscode.workspace.onDidChangeTextDocument(async (e) => {
        if (e.document === document && !isUpdating) {
            isUpdating = true;
            await updateOriginalYaml();
            isUpdating = false;
        }
    });
}

function setupCloseHandler(document: vscode.TextDocument) {
    return vscode.workspace.onDidCloseTextDocument(async (closedDoc) => {
        if (closedDoc === document) {
            zoomedEditor = undefined;
            yamlPath = undefined;
        }
    });
}

async function updateOriginalYaml() {
    if (!zoomedEditor || !originalEditor || !yamlPath) return;

    const zoomedContent = zoomedEditor.document.getText();
    const yamlContent = originalEditor.document.getText();

    if (!zoomedContent) return;

    try {
        const parsedYaml = yaml.load(yamlContent, { schema: yaml.DEFAULT_SCHEMA }) as any;

        // Remove the YAML path comment and any leading newlines
        const fieldValue = zoomedContent.replace(/^# YAML Path:.*\r?\n\r?\n/, '').trim();

        // Update the value in the parsed YAML
        setNestedValue(parsedYaml, yamlPath, fieldValue);

        // Convert the updated YAML back to a string
        let updatedYaml = yaml.dump(parsedYaml, {
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
        handleError(error);
    }
}

function handleError(error: unknown) {
    if (error instanceof Error) {
        outputChannel.appendLine(`Error: ${error.message}`);
        outputChannel.appendLine(error.stack || "No stack trace available");
        vscode.window.showErrorMessage(`Error: ${error.message}`);
    } else {
        outputChannel.appendLine(`An unexpected error occurred: ${String(error)}`);
        vscode.window.showErrorMessage('An unexpected error occurred');
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
                    return currentPath.join('.');
            }            
        }
        return undefined;
    }
    return traverse(obj);
}

function getNestedValue(obj: any, path: string): any {
    const parts = path.split('.').filter(part => part !== '');
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

    if (typeof current === 'object' && current !== null && 'toString' in current) {
        return current.toString();
    }

    return current;
}

function setNestedValue(obj: any, path: string, value: string): void {
    outputChannel.appendLine(`${eol}Setting nested value for path: ${path}`);
    outputChannel.appendLine(`Value to set: ${value}`);

    const parts = path.split('.').filter(part => part !== '');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (part.endsWith(']')) {
            const [arrayName, indexStr] = part.split('[');
            const index = parseInt(indexStr, 10);
            if (!current[arrayName]) {
                current[arrayName] = [];
            }
            if (!current[arrayName][index]) {
                current[arrayName][index] = {};
            }
            current = current[arrayName][index];
        } else {
            if (!current[part]) {
                current[part] = {};
            }
            current = current[part];
        }
    }

    const lastPart = parts[parts.length - 1];
    if (lastPart.endsWith(']')) {
        const [arrayName, indexStr] = lastPart.split('[');
        const index = parseInt(indexStr, 10);
        if (!current[arrayName]) {
            current[arrayName] = [];
        }
        current[arrayName][index] = value;
    } else {
        current[lastPart] = value;
    }

    outputChannel.appendLine("Nested value set");
}

async function detectLanguage(content: string): Promise<string> {
    // Check for known shebangs or language markers
    if (content.startsWith('#!/bin/bash') || content.includes('#!/usr/bin/env bash') ||
        content.startsWith('#!/bin/sh') || content.includes('#!/usr/bin/env sh')) {
        return 'shellscript';
    }
    if (content.startsWith('#!/usr/bin/env python') || content.startsWith('#!/bin/python' || 
        content.startsWith('#!/usr/libexec/platform-python'))) {
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
