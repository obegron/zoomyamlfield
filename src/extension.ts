import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

let zoomedEditor: vscode.TextEditor | undefined;
let originalEditor: vscode.TextEditor | undefined;
let yamlPath: string | undefined;
let isUpdating = false;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel("YAML Field Editor");
    outputChannel.show();
    outputChannel.appendLine("Extension activated");
    
    let disposable = vscode.commands.registerCommand('extension.zoomYamlField', async () => {
        originalEditor = vscode.window.activeTextEditor;
        if (!originalEditor) {
            vscode.window.showErrorMessage('No active editor!');
            return;
        }

        outputChannel.appendLine(`yamlPath ${yamlPath}`);
        if(!yamlPath){
            yamlPath = await vscode.window.showInputBox({
                prompt: 'Enter YAML path (e.g., spec.template.spec.containers[0].env[0].value)',
            });
        }

        if (!yamlPath) return;

        if (!yamlPath.startsWith('.')) {
            yamlPath = '.' + yamlPath;
        }

        const document = originalEditor.document;
        const yamlContent = document.getText();
        
        try {
            const parsedYaml = yaml.load(yamlContent) as any;
            const fieldValue = getNestedValue(parsedYaml, yamlPath);
    
            if (fieldValue === undefined) {
                throw new Error('Field not found in YAML '+yamlPath);
            }
    
            let stringValue: string;
            if (typeof fieldValue === 'string') {
                stringValue = fieldValue;
            } else if (typeof fieldValue === 'object') {
                stringValue = yaml.dump(fieldValue);
            } else {
                stringValue = String(fieldValue);
            }
    
            const detectedLanguage = await detectLanguage(stringValue);
    
            const newDocument = await vscode.workspace.openTextDocument({
                content: `# YAML Path: ${yamlPath}\n\n${stringValue}`,
                language: detectedLanguage
            });

            zoomedEditor = await vscode.window.showTextDocument(newDocument, vscode.ViewColumn.Beside);

            // Highlight the YAML path
            const range = new vscode.Range(0, 0, 0, yamlPath.length + 13);
            zoomedEditor.setDecorations(vscode.window.createTextEditorDecorationType({
                backgroundColor: new vscode.ThemeColor('editor.lineHighlightBackground'),
                isWholeLine: true,
            }), [range]);

            // Set up a change handler for the zoomed document
            const changeHandler = vscode.workspace.onDidChangeTextDocument(async (e) => {
                if (e.document === newDocument && !isUpdating) {
                    isUpdating = true;
                    await updateOriginalYaml();
                    isUpdating = false;
                }
            });

            // Set up a close handler for the zoomed document
            const closeHandler = vscode.workspace.onDidCloseTextDocument(async (closedDoc) => {
                if (closedDoc === newDocument) {
                    changeHandler.dispose();
                    closeHandler.dispose();
                    zoomedEditor = undefined;
                    yamlPath = undefined;
                }
            });

            context.subscriptions.push(changeHandler, closeHandler);

        } catch (error) {
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Error: ${error.message}`);
            } else {
                vscode.window.showErrorMessage('An unexpected error occurred');
            }
        }
    });
    context.subscriptions.push(disposable);

    let activateKeyDisposable = vscode.commands.registerCommand('extension.activateYamlKey', async () => {
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
            const keyMatch = lineText.match(/^\s*([^:]+):/);

            if (keyMatch) {
                let key = keyMatch[1].trim();
                if (!key.startsWith('.')) {
                    key = '.' + yamlPath;
                }
                const path = getYamlPath(parsedYaml, key, cursorPosition.line);

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
                    vscode.window.showWarningMessage(`Could not determine path for key "${key}".`);
                }
            } else {
                vscode.window.showWarningMessage('No YAML key found at cursor position.');
            }
        } catch (error) {
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Error parsing YAML: ${error.message}`);
            } else {
                vscode.window.showErrorMessage('An unexpected error occurred while parsing YAML');
            }
        }
    });
    context.subscriptions.push(activateKeyDisposable);

}

function getYamlPath(obj: any, targetKey: string, targetLine: number): string | undefined {
    function traverse(current: any, path: string[] = [], line: number = 0): string | undefined {
        if (typeof current !== 'object' || current === null) {
            return undefined;
        }

        for (const [key, value] of Object.entries(current)) {
            const currentPath = [...path, key];
            
            if (key === targetKey && line === targetLine) {
                return currentPath.join('.');
            }

            if (typeof value === 'object' && value !== null) {
                const result = traverse(value, currentPath, line + 1);
                if (result) return result;
            } else if (typeof value === 'string') {
                const lines = value.split('\n').length;
                if (line <= targetLine && targetLine < line + lines) {
                    return currentPath.join('.');
                }
                line += lines - 1;
            }

            line++;
        }

        return undefined;
    }

    return traverse(obj);
}

async function detectLanguage(content: string): Promise<string> {
    // Check for common script headers
    if (content.startsWith('#!/bin/bash') || content.includes('#!/usr/bin/env bash')) {
        return 'shellscript';
    }
    if (content.startsWith('#!/usr/bin/env python')) {
        return 'python';
    }
    
    // Use VSCode's built-in language detection
    const languageId = await vscode.languages.getLanguages().then(languages => {
        for (const lang of languages) {
            const languageConfiguration = vscode.workspace.getConfiguration(`[${lang}]`);
            const patterns = languageConfiguration.get('files.associations') as { [key: string]: string } | undefined;
            if (patterns) {
                for (const pattern in patterns) {
                    if (new RegExp(pattern).test(content)) {
                        return lang;
                    }
                }
            }
        }
        return 'plaintext'; // Default to plaintext if no match found
    });

    return languageId;
}

async function updateOriginalYaml() {
    if (!zoomedEditor || !originalEditor || !yamlPath) return;

    const zoomedContent = zoomedEditor.document.getText();
    const yamlContent = originalEditor.document.getText();

    if (!zoomedContent) return;
    
    try {
        const parsedYaml = yaml.load(yamlContent) as any;

        // Remove the YAML path comment and any leading newlines
        const fieldValue = zoomedContent.replace(/^# YAML Path:.*\r?\n\r?\n/, '').trim();

        // Preserve multi-line formatting
        setNestedValue(parsedYaml, yamlPath, fieldValue, true);

        const updatedYaml = yaml.dump(parsedYaml, {
            lineWidth: -1,  // Disable line wrapping
            noRefs: true,   // Prevent anchors and aliases
            noCompatMode: true,  // Use new YAML 1.2 boolean format
        });

        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            originalEditor.document.uri,
            new vscode.Range(0, 0, originalEditor.document.lineCount, 0),
            updatedYaml
        );

        await vscode.workspace.applyEdit(edit);
    } catch (error) {
        if (error instanceof Error) {
            vscode.window.showErrorMessage(`Error updating YAML: ${error.message}`);
        } else {
            vscode.window.showErrorMessage('An unexpected error occurred while updating YAML');
        }
    }
}

function setNestedValue(obj: any, path: string, value: any, preserveMultiline: boolean = false): void {
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
        current[arrayName][index] = preserveMultiline ? preserveMultilineString(value) : value;
    } else {
        current[lastPart] = preserveMultiline ? preserveMultilineString(value) : value;
    }
}

function preserveMultilineString(value: string): string {
    const lines = value.split('\n');
    if (lines.length > 1) {
        return lines.join('\n');
    }
    return value;
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

    // Handle multi-line strings (which are parsed as objects by js-yaml)
    if (typeof current === 'object' && current !== null && 'toString' in current) {
        return current.toString();
    }

    return current;
}


export function deactivate() {
    if (zoomedEditor) {
        zoomedEditor = undefined;  // Simply clear the zoomed editor without affecting the original content
    }
    yamlPath = undefined;
}