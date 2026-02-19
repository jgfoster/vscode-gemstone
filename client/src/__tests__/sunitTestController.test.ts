import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

vi.mock('../sunitQueries', () => ({
  discoverTestClasses: vi.fn(() => [
    { dictName: 'UserGlobals', className: 'MyTestCase' },
    { dictName: 'Globals', className: 'OtherTest' },
  ]),
  discoverTestMethods: vi.fn(() => [
    { selector: 'testAdd', category: 'unit tests' },
    { selector: 'testRemove', category: 'unit tests' },
  ]),
  runTestMethod: vi.fn(() => ({
    className: 'MyTestCase',
    selector: 'testAdd',
    status: 'passed',
    message: '',
    durationMs: 10,
  })),
  runTestClass: vi.fn(() => [
    { className: 'MyTestCase', selector: 'testAdd', status: 'passed', message: '', durationMs: 5 },
    { className: 'MyTestCase', selector: 'testRemove', status: 'failed', message: 'Expected true', durationMs: 3 },
  ]),
  SunitQueryError: class SunitQueryError extends Error {
    gciErrorNumber: number;
    constructor(message: string, gciErrorNumber = 0) {
      super(message);
      this.gciErrorNumber = gciErrorNumber;
    }
  },
}));

import { tests, window } from '../__mocks__/vscode';
import { SunitTestController } from '../sunitTestController';
import { SessionManager } from '../sessionManager';
import * as sunit from '../sunitQueries';

function makeSessionManager(hasSession: boolean) {
  return {
    getSelectedSession: vi.fn(() =>
      hasSession
        ? { id: 1, gci: {}, handle: {}, login: { label: 'Test' }, stoneVersion: '3.7.2' }
        : undefined
    ),
    onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
  } as unknown as SessionManager;
}

describe('SunitTestController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a TestController on construction', () => {
    const sm = makeSessionManager(true);
    const ctrl = new SunitTestController(sm);
    expect(tests.createTestController).toHaveBeenCalledWith('gemstone-sunit', 'GemStone SUnit Tests');
    ctrl.dispose();
  });

  it('creates a Run profile', () => {
    const sm = makeSessionManager(true);
    const ctrl = new SunitTestController(sm);
    const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(mockController.createRunProfile).toHaveBeenCalledOnce();
    ctrl.dispose();
  });

  it('listens for session changes', () => {
    const sm = makeSessionManager(true);
    const ctrl = new SunitTestController(sm);
    expect(sm.onDidChangeSelection).toHaveBeenCalledOnce();
    ctrl.dispose();
  });

  describe('discovery via resolveHandler', () => {
    it('discovers test classes when resolveHandler is called with no item', async () => {
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock.results[0].value;

      // Call resolveHandler at root level
      await mockController.resolveHandler(undefined);

      expect(sunit.discoverTestClasses).toHaveBeenCalledOnce();
      expect(mockController.createTestItem).toHaveBeenCalledTimes(2);
      ctrl.dispose();
    });

    it('returns empty when no session is active', async () => {
      const sm = makeSessionManager(false);
      const ctrl = new SunitTestController(sm);
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock.results[0].value;

      await mockController.resolveHandler(undefined);

      expect(sunit.discoverTestClasses).not.toHaveBeenCalled();
      ctrl.dispose();
    });

    it('discovers test methods when resolveHandler is called with a class item', async () => {
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock.results[0].value;

      // First discover classes
      await mockController.resolveHandler(undefined);

      // Get first class item and resolve its children
      const classItem = mockController.createTestItem.mock.results[0].value;
      await mockController.resolveHandler(classItem);

      expect(sunit.discoverTestMethods).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        'MyTestCase',
      );
      ctrl.dispose();
    });

    it('shows error message when discovery fails', async () => {
      (sunit.discoverTestClasses as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('TestCase not found');
      });

      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock.results[0].value;

      await mockController.resolveHandler(undefined);

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('TestCase not found'),
      );
      ctrl.dispose();
    });
  });

  describe('refresh', () => {
    it('clears items on refresh', async () => {
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock.results[0].value;

      // Discover first
      await mockController.resolveHandler(undefined);

      // Items were populated
      expect(mockController.items.size).toBe(2);

      // Refresh clears them
      ctrl.refresh();
      expect(mockController.items.size).toBe(0);

      ctrl.dispose();
    });
  });

  describe('session change', () => {
    it('re-discovers tests when session changes', async () => {
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock.results[0].value;

      // Discover
      await mockController.resolveHandler(undefined);
      expect(mockController.items.size).toBe(2);
      expect(sunit.discoverTestClasses).toHaveBeenCalledTimes(1);

      // Simulate session change — should clear and re-discover
      const listener = (sm.onDidChangeSelection as ReturnType<typeof vi.fn>).mock.calls[0][0];
      await listener(2);

      expect(sunit.discoverTestClasses).toHaveBeenCalledTimes(2);
      expect(mockController.items.size).toBe(2);
      ctrl.dispose();
    });
  });

  describe('runClassByName', () => {
    it('runs tests for a discovered class', async () => {
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock.results[0].value;

      // Discover
      await mockController.resolveHandler(undefined);

      await ctrl.runClassByName('MyTestCase');

      expect(sunit.runTestClass).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        'MyTestCase',
      );
      ctrl.dispose();
    });

    it('shows warning when class is not a TestCase subclass', async () => {
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);

      await ctrl.runClassByName('NotATestClass');

      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('NotATestClass'),
      );
      ctrl.dispose();
    });

    it('shows error when no session', async () => {
      const sm = makeSessionManager(false);
      const ctrl = new SunitTestController(sm);

      await ctrl.runClassByName('MyTestCase');

      expect(window.showErrorMessage).toHaveBeenCalledWith('No active GemStone session.');
      ctrl.dispose();
    });
  });

  describe('dispose', () => {
    it('disposes the controller', () => {
      const sm = makeSessionManager(true);
      const ctrl = new SunitTestController(sm);
      const mockController = (tests.createTestController as ReturnType<typeof vi.fn>).mock.results[0].value;

      ctrl.dispose();

      expect(mockController.dispose).toHaveBeenCalledOnce();
    });
  });
});
