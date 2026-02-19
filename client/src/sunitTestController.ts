import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import * as sunit from './sunitQueries';

/**
 * Integrates GemStone SUnit tests with VS Code's Test Explorer.
 *
 * Test item ID scheme:
 *   Class:  sunit/<sessionId>/<className>
 *   Method: sunit/<sessionId>/<className>/<selector>
 */
export class SunitTestController implements vscode.Disposable {
  private controller: vscode.TestController;
  private disposables: vscode.Disposable[] = [];

  /** dictName cache populated during discovery, keyed by className */
  private classDict = new Map<string, string>();

  /** category cache populated during method discovery, keyed by className/selector */
  private methodCategory = new Map<string, string>();

  constructor(private sessionManager: SessionManager) {
    this.controller = vscode.tests.createTestController(
      'gemstone-sunit',
      'GemStone SUnit Tests',
    );

    this.controller.resolveHandler = async (item) => {
      if (!item) {
        await this.discoverTests();
      } else {
        await this.resolveTestMethods(item);
      }
    };

    this.controller.createRunProfile(
      'Run Tests',
      vscode.TestRunProfileKind.Run,
      (request, token) => this.runTests(request, token),
      true,
    );

    this.controller.refreshHandler = async () => {
      this.classDict.clear();
      this.methodCategory.clear();
      this.controller.items.replace([]);
      await this.discoverTests();
    };

    this.disposables.push(
      sessionManager.onDidChangeSelection(async () => {
        this.classDict.clear();
        this.methodCategory.clear();
        this.controller.items.replace([]);
        await this.discoverTests();
      }),
    );
  }

  dispose(): void {
    this.controller.dispose();
    for (const d of this.disposables) d.dispose();
  }

  /** Clear items and let resolveHandler re-discover on next view. */
  refresh(): void {
    this.classDict.clear();
    this.methodCategory.clear();
    this.controller.items.replace([]);
  }

  /** Run all tests in a named class (bridge for browser tree context menu). */
  async runClassByName(className: string): Promise<void> {
    const session = this.sessionManager.getSelectedSession();
    if (!session) {
      vscode.window.showErrorMessage('No active GemStone session.');
      return;
    }

    // Ensure discovery has run so the item exists
    let classItem: vscode.TestItem | undefined;
    this.controller.items.forEach(item => {
      if (item.label === className) classItem = item;
    });

    if (!classItem) {
      await this.discoverTests();
      this.controller.items.forEach(item => {
        if (item.label === className) classItem = item;
      });
    }

    if (!classItem) {
      vscode.window.showWarningMessage(`${className} is not a TestCase subclass.`);
      return;
    }

    // Ensure children are resolved
    if (classItem.children.size === 0) {
      await this.resolveTestMethods(classItem);
    }

    // Run directly via a TestRun
    const run = this.controller.createTestRun(
      { include: [classItem], exclude: [], profile: undefined, preserveFocus: false } as vscode.TestRunRequest,
    );
    const neverCancelled = { isCancellationRequested: false } as vscode.CancellationToken;
    await this.runClassTests(session, run, classItem, className, neverCancelled);
    run.end();
  }

  // ── Discovery ──────────────────────────────────────────────

  private async discoverTests(): Promise<void> {
    const session = this.sessionManager.getSelectedSession();
    if (!session) return;

    try {
      const classes = sunit.discoverTestClasses(session);
      const items: vscode.TestItem[] = [];

      for (const cls of classes) {
        this.classDict.set(cls.className, cls.dictName);

        const uri = vscode.Uri.parse(
          `gemstone://${session.id}` +
          `/${encodeURIComponent(cls.dictName)}` +
          `/${encodeURIComponent(cls.className)}` +
          `/definition`,
        );
        const classItem = this.controller.createTestItem(
          `sunit/${session.id}/${cls.className}`,
          cls.className,
          uri,
        );
        classItem.canResolveChildren = true;
        classItem.description = cls.dictName;
        items.push(classItem);
      }

      this.controller.items.replace(items);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`SUnit discovery failed: ${msg}`);
    }
  }

  private async resolveTestMethods(classItem: vscode.TestItem): Promise<void> {
    const session = this.sessionManager.getSelectedSession();
    if (!session) return;

    const className = classItem.label;
    const dictName = this.classDict.get(className) ?? '';

    try {
      const methods = sunit.discoverTestMethods(session, className);
      const children: vscode.TestItem[] = [];

      for (const { selector, category } of methods) {
        this.methodCategory.set(`${className}/${selector}`, category);

        const uri = vscode.Uri.parse(
          `gemstone://${session.id}` +
          `/${encodeURIComponent(dictName)}` +
          `/${encodeURIComponent(className)}` +
          `/instance` +
          `/${encodeURIComponent(category || 'as yet unclassified')}` +
          `/${encodeURIComponent(selector)}`,
        );
        const methodItem = this.controller.createTestItem(
          `sunit/${session.id}/${className}/${selector}`,
          selector,
          uri,
        );
        children.push(methodItem);
      }

      classItem.children.replace(children);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      classItem.error = new vscode.MarkdownString(`Discovery failed: ${msg}`);
    }
  }

  // ── Test Execution ─────────────────────────────────────────

  private async runTests(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const session = this.sessionManager.getSelectedSession();
    if (!session) {
      vscode.window.showErrorMessage('No active GemStone session.');
      return;
    }

    const run = this.controller.createTestRun(request);
    const queue = this.getTestsToRun(request);

    for (const item of queue) {
      if (token.isCancellationRequested) {
        run.skipped(item);
        continue;
      }

      const parts = item.id.split('/');
      // parts: ['sunit', sessionId, className] or ['sunit', sessionId, className, selector]

      if (parts.length === 3) {
        await this.runClassTests(session, run, item, parts[2], token);
      } else if (parts.length === 4) {
        run.started(item);
        this.runSingleTest(session, run, item, parts[2], parts[3]);
      }
    }

    run.end();
  }

  private getTestsToRun(request: vscode.TestRunRequest): vscode.TestItem[] {
    const queue: vscode.TestItem[] = [];

    if (request.include) {
      for (const item of request.include) {
        queue.push(item);
      }
    } else {
      this.controller.items.forEach(item => queue.push(item));
    }

    const excluded = new Set(request.exclude?.map(i => i.id) ?? []);
    return queue.filter(i => !excluded.has(i.id));
  }

  private runSingleTest(
    session: ActiveSession,
    run: vscode.TestRun,
    item: vscode.TestItem,
    className: string,
    selector: string,
  ): void {
    try {
      const result = sunit.runTestMethod(session, className, selector);
      this.reportResult(run, item, result);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      run.errored(item, new vscode.TestMessage(`Execution error: ${msg}`));
    }
  }

  private async runClassTests(
    session: ActiveSession,
    run: vscode.TestRun,
    classItem: vscode.TestItem,
    className: string,
    token: vscode.CancellationToken,
  ): Promise<void> {
    // Ensure children are resolved
    if (classItem.children.size === 0) {
      await this.resolveTestMethods(classItem);
    }

    // Mark all children as started
    run.started(classItem);
    classItem.children.forEach(child => run.started(child));

    try {
      const results = sunit.runTestClass(session, className);
      const resultMap = new Map(results.map(r => [r.selector, r]));

      let allPassed = true;
      classItem.children.forEach(child => {
        const selector = child.id.split('/')[3];
        const result = resultMap.get(selector);

        if (!result) {
          run.skipped(child);
          return;
        }

        this.reportResult(run, child, result);
        if (result.status !== 'passed') allPassed = false;
      });

      if (allPassed) {
        run.passed(classItem);
      } else {
        run.failed(classItem, new vscode.TestMessage('Some tests failed.'));
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const errMsg = new vscode.TestMessage(`Execution error: ${msg}`);
      run.errored(classItem, errMsg);
      classItem.children.forEach(child => {
        run.errored(child, new vscode.TestMessage(`Class execution error: ${msg}`));
      });
    }
  }

  private reportResult(
    run: vscode.TestRun,
    item: vscode.TestItem,
    result: sunit.TestRunResult,
  ): void {
    switch (result.status) {
      case 'passed':
        run.passed(item, result.durationMs);
        break;
      case 'failed':
        run.failed(item, new vscode.TestMessage(result.message), result.durationMs);
        break;
      case 'error':
        run.errored(item, new vscode.TestMessage(result.message), result.durationMs);
        break;
    }
  }
}
