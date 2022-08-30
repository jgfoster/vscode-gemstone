# File System Provider Demo

## Workspace

To use this extension you need to have a Workspace with at least one folder ("If the first workspace folder is added, removed or changed, the currently executing extensions (including the one that called this method) will be terminated and restarted" [updateWorkspaceFolders()](https://code.visualstudio.com/api/references/vscode-api#workspace.updateWorkspaceFolders), and we can't have that!). In Code,
* Select the `New Window` menu
* Select the `Add Folder to Workspace...` menu and select a convenient folder
  * While it could be anywhere, consider a place where you could save Smalltalk scripts or have related source code
* Select the `Save the Workspace as...` menu

## Development

This is a Visual Studio Code [extension](https://code.visualstudio.com/api) written in TypeScript and running in a Node.js environment. Execute the following command in a terminal to install the dependencies:

```
npm install
```
