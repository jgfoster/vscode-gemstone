# Future Features

Deferred features for the GemStone VS Code extension.

## System Browser

### Hierarchy View
Display the class hierarchy for a selected class in the System Browser, similar to the Jade browser's hierarchy view. The data layer already exists (`getClassHierarchy()` in `browserQueries.ts`).

### Context Menus in Webview Columns
Re-add mutation commands as context menus on the webview columns:

- **Dictionary column**: Add Dictionary, Move Up, Move Down
- **Class Category column**: New Class Category
- **Class column**: Delete Class, Move to Dictionary, Run SUnit Tests, Inspect Global, New Class
- **Method Category column**: New Method, Rename Category
- **Method column**: Delete Method, Move to Category, Senders Of, Implementors Of, New Method

### Drag-and-Drop in Webview
- Drag methods between categories to recategorize
- Drag classes between dictionaries to move

### Multiple Environments
When `gemstone.maxEnvironment > 0`, show environment tabs or a selector in the method categories column to browse methods in environments 0 through N.

## Inspector

### Non-Class Globals
Display non-class globals (from `getDictionaryEntries()` where `isClass: false`) in the Inspector tree view. This would provide a way to navigate and inspect global objects that are not classes (e.g., `AllUsers`, `UserProfile`).
