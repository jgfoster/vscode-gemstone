# GemStone/S 64 Bit IDE

The `gemstone` Visual Studio Code extension allows you to interact with [GemStone/S](https://gemtalksystems.com/products/gs64/), a Smalltalk object application server and database. See this two-minute [video](https://www.youtube.com/watch?v=gO1t3_a4dKE) showing its operation.

## Features

* Log in to GemStone
* Execute code in a workspace
* View class in Topaz format

## Instructions

### Workspace

Note: To use this extension you do not need to fork, clone, or download the GitHub project. The GitHub repository is needed only for development. The usage is integrated with VS Code and the needed parts are downloaded from the proper places (not GitHub) using the instructions below.

To use this extension you need to have a Workspace with at least one open folder. In Code,
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

You should define at least one login defined.
* Open the user settings (with the `Open User Settings` command) or the workspace settings (`Open Workspace Settings`).
* Select Extensions from the list on the left, click on GemStone, and click the `Edit in settings.js` link.
* At the end of the JSON list, add a new entry for `gemstone.logins`.
* This should give you a default set of settings that you can modify or add to.
These items should appear in the Logins List when you select the GemStone icon on the left.

## Known Issues

This extension is primarily a proof-of-concept to show that we can interact with a GemStone server from VSCode. Other than a way to explore the possibilities, it doesn't provide much functionality [yet](https://www.jstor.org/stable/986790).

Initial development has been with VSCode 1.35.1 on macOS 10.14.5 with Node 12.4.0 and login to GemStone/S 64 Bit 3.5.0 running locally.

# Development

This is a Visual Studio Code [extension](https://code.visualstudio.com/api) written in TypeScript and running in a Node.js environment.

```
npm install
```

We use webpack to [bundle](https://code.visualstudio.com/api/working-with-extensions/bundling-extension) the extension:

```
npm i --save-dev webpack webpack-cli ts-loader
```

We use [vsce](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) to manage packaging and publishing: `npm install -g vsce`.
