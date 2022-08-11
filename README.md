# GemStone/S 64 Bit IDE

The `gemstone` Visual Studio Code extension allows you to interact with [GemStone/S](https://gemtalksystems.com/products/gs64/), a Smalltalk object application server and database. See this two-minute [video](https://www.youtube.com/watch?v=gO1t3_a4dKE) showing its operation.

## Features

* Log in to GemStone
* Execute code in a workspace
* View class in Topaz format

## Instructions

### GemStone

The traditional approach to a GemStone IDE requires a GCI library on the client and then can connect to a running database without any code installed on the server. While this could be done here, it requires distribution of a GCI library appropriate for the platform (Linux, macOS, or Windows) and GemStone version. Here we follow a different approach and specify that some [code](https://github.com/jgfoster/WebGS/blob/main/installGCI.sh) must be installed on the server that supports a WebSocket connection. With this, we don't need to worry about a local GCI library.

### Workspace

Note: To use this extension you do _not_ need to fork, clone, or download the GitHub project. The GitHub repository is needed only for development. The usage is integrated with VS Code and installed as is any other extension using the instructions below.

To use this extension you need to have a Workspace with at least one folder ("If the first workspace folder is added, removed or changed, the currently executing extensions (including the one that called this method) will be terminated and restarted" [updateWorkspaceFolders()](https://code.visualstudio.com/api/references/vscode-api#workspace.updateWorkspaceFolders), and we can't have that!). In Code,
* Select the `New Window` menu
* Select the `Add Folder to Workspace...` menu and select a convenient folder
  * While it could be anywhere, consider a place where you could save Smalltalk scripts or have related source code
* Select the `Save the Workspace as...` menu

### Install Extension

* Navigate to the Extensions view
  * `<Ctrl>+<Shift>+<P>` then `install extensions`
* Enter `gemstone`
* Select and install the GemStone IDE

### Login

You should define at least one login.
* Open the user settings (with the `Open User Settings` command) or the workspace settings (`Open Workspace Settings`).
* Select Extensions from the list on the left, click on GemStone, and click the `Edit in settings.js` link.
* At the end of the JSON list, add a new entry for `gemstone.logins`.
* This should give you a default set of settings that you can modify or add to.
These items should appear in the Logins List when you select the GemStone icon on the left.

## Known Issues

This extension is primarily a proof-of-concept to show that we can interact with a GemStone server from VSCode. Other than a way to explore the possibilities, it doesn't provide much functionality [yet](https://www.jstor.org/stable/986790).

Recent development has been with VSCode 1.62.2 on macOS 10.15.7 with Node 18.6.0 and login to GemStone/S 64 Bit 3.6.4 running locally.

# Development

This is a Visual Studio Code [extension](https://code.visualstudio.com/api) written in TypeScript and running in a Node.js environment. Execute the following command in a terminal to install the dependencies:

```
npm install
```

Then use the "Run and Debug" command in Visual Studio Code to start a new window.

We use webpack to [bundle](https://code.visualstudio.com/api/working-with-extensions/bundling-extension) the extension:

```
npm i --save-dev webpack webpack-cli ts-loader
```

We use [vsce](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) to manage packaging and publishing: `npm install -g vsce`.
