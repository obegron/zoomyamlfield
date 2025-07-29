# YAML Field Editor

This extension provides a "zoom" functionality for editing specific fields within a YAML file. It's particularly useful when a YAML field contains a large block of text, like an embedded script, a multi-line string, or another complex data structure.

Instead of editing this content inside the main YAML file, which can be cumbersome, the extension extracts the field's value and opens it in a new, separate editor tab. It even tries to detect the language of the content (e.g., shell, python) to provide proper syntax highlighting in the new tab.

Any edits you make in this new "zoomed-in" tab are automatically and instantly reflected back into the original YAML file.

## How to Use It

1.  **Open a YAML file** in VS Code.
2.  **Find the field** you want to edit.
3.  **Right-click** anywhere on the line containing the key or value of that field.
4.  From the context menu, select **"Zoom edit YAML Field"**.
5.  A new editor tab will open next to your YAML file, showing only the content of the selected field.
6.  **Edit the content** in this new tab as needed. Your changes are saved back to the original YAML file in real-time.
7.  When you are finished, simply **close the new editor tab**.