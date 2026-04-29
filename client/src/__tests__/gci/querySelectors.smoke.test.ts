// Selector-existence probe: every GemStone selector we hardcode in
// `client/src/queries/*.ts` must actually exist on the receiver class
// we send it to. The whole point of these smoke tests is to catch
// "looks reasonable but doesn't compile/run" misfires that the
// "expect(code).toContain(...)" unit tests can't.
//
// Each row is a sentence: "we send X to Y, so Y must canUnderstand X".
// When a selector turns out to be wrong (the round-3 `asUtf8` →
// `encodeAsUTF8` typo), this test fails immediately with a clear
// message instead of producing an obscure runtime error inside a
// downstream tool.
//
// Lines are intentionally redundant with the smoke tests for each
// individual query — the per-query tests confirm "this tool works
// end-to-end on this stone"; this test confirms "every selector we
// reference exists on the receiver we send it to," which is faster
// to bisect when something does break.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HarnessSession, login, selectorExists } from './queryHarness';

interface SelectorClaim {
  /** A short label for the test name; helps locate the offending row. */
  label: string;
  /** The receiver class as written in our query source. */
  className: string;
  /** True when the selector is sent to the metaclass (`Foo class`). */
  meta?: boolean;
  /** The selector text, exactly as it appears in our query. */
  selector: string;
}

// Curated from a grep of `client/src/queries/*.ts` for non-obvious
// selectors — anything beyond the SmallTalk-90 core we'd be surprised by
// if it weren't there. Includes both round-3-relevant ones and the
// "always assumed to exist" ones we depend on.
const claims: SelectorClaim[] = [
  // Encoding: the round-3 selector we got wrong. If the `asUtf8` →
  // `encodeAsUTF8` rename ever regresses, this fails first.
  { label: 'Unicode7 understands encodeAsUTF8', className: 'Unicode7', selector: 'encodeAsUTF8' },
  { label: 'Unicode16 understands encodeAsUTF8', className: 'Unicode16', selector: 'encodeAsUTF8' },
  { label: 'Unicode32 understands encodeAsUTF8', className: 'Unicode32', selector: 'encodeAsUTF8' },

  // Stream class: the round-3 Utf8 immutability bug. Unicode7 must accept
  // at:put: (i.e. extend) for `WriteStream on: Unicode7 new` to work as
  // we use it. Utf8 famously does not, so we don't claim that.
  { label: 'Unicode7 supports at:put: (extensible buffer)', className: 'Unicode7', selector: 'at:put:' },

  // Exception protocol — used by describeTestFailure / runFailingTests /
  // runTestMethod / runTestClass to format the message column.
  { label: 'AbstractException understands messageText', className: 'AbstractException', selector: 'messageText' },
  { label: 'AbstractException understands description', className: 'AbstractException', selector: 'description' },
  { label: 'AbstractException understands number', className: 'AbstractException', selector: 'number' },
  { label: 'AbstractException understands stackReport', className: 'AbstractException', selector: 'stackReport' },
  // mnu-specific accessors live on MessageNotUnderstood.
  { label: 'MessageNotUnderstood understands receiver', className: 'MessageNotUnderstood', selector: 'receiver' },
  { label: 'MessageNotUnderstood understands selector', className: 'MessageNotUnderstood', selector: 'selector' },

  // SUnit: TestCase>>run is what describeTestFailure deliberately bypasses;
  // setUp/tearDown/perform: are what we call instead.
  { label: 'TestCase understands setUp', className: 'TestCase', selector: 'setUp' },
  { label: 'TestCase understands tearDown', className: 'TestCase', selector: 'tearDown' },
  { label: 'TestCase understands selector (the test method name)', className: 'TestCase', selector: 'selector' },
  // suite is class-side.
  { label: 'TestCase class understands suite', className: 'TestCase', meta: true, selector: 'suite' },

  // Pattern-matching for list_failing_tests classNamePattern. The
  // *correct* glob primitive in GemStone is `sunitMatch:` — `match:` is
  // a case-sensitive prefix matcher (returns true iff the receiver
  // starts with the argument), which is what previously made
  // classNamePattern silently match nothing.
  { label: 'String understands sunitMatch:', className: 'String', selector: 'sunitMatch:' },

  // Stack capture: describeTestFailure toggles GemExceptionSignalCapturesStack
  // around the run via gemConfigurationAt:put:. If the setter is missing,
  // the toggle silently no-ops and stackReport returns nil — which the
  // tool tolerates, but it's worth flagging that the config name is right.
  { label: 'System class understands gemConfigurationAt:put:', className: 'System', meta: true, selector: 'gemConfigurationAt:put:' },
  { label: 'System class understands gemConfigurationAt:', className: 'System', meta: true, selector: 'gemConfigurationAt:' },
];

describe('selectors used by shared queries (live GCI)', () => {
  let s: HarnessSession;

  beforeAll(() => { s = login(); });
  afterAll(() => { s?.logout(); });

  it.each(claims)('$label', ({ className, selector, meta }) => {
    const exists = selectorExists(s.exec, className, selector, meta ?? false);
    expect(exists, `${meta ? `${className} class` : className} >> #${selector} not found in this stone`).toBe(true);
  });
});
