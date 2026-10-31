import { describe, expect, it } from 'vitest';
import { InspectorError } from '../device/ios/inspector/protocol';
import {
  PageDriver,
  PageElement,
  PageScriptError,
  StaleElementError,
} from '../device/ios/page-driver';
import { fakePage, recorded, Refusal, WINDOW } from './page-driver-fake';

/**
 * The iPhone run's page driver (#859): each method is pinned on the commands
 * it sends and on the answers the phone gave in the 2026-10-31 probes.
 */

describe('executeScript: a function body run on the page, its value returned', () => {
  it('runs the body on a fresh window handle and returns the value', async () => {
    const page = fakePage({
      'Runtime.evaluate': [WINDOW],
      'Runtime.callFunctionOn': [recorded('callFunctionOn handle')],
    });
    const value = await new PageDriver(page).executeScript<string>(
      'return arguments[0] + arguments[1];',
      ['a', 2],
    );
    expect(value).toBe('A!');
    expect(page.sent).toEqual([
      { method: 'Runtime.evaluate', params: { expression: 'window' } },
      {
        method: 'Runtime.callFunctionOn',
        params: {
          objectId: WINDOW.result.objectId,
          functionDeclaration:
            'function () {return arguments[0] + arguments[1];\n}',
          arguments: [{ value: 'a' }, { value: 2 }],
          returnByValue: true,
        },
      },
    ]);
  });

  it('turns an exception the page threw into a PageScriptError naming the script and the error', async () => {
    const page = fakePage({
      'Runtime.evaluate': [WINDOW],
      'Runtime.callFunctionOn': [recorded('thrown error')],
    });
    const run = new PageDriver(page).executeScript('\n  return boom();\n');
    await expect(run).rejects.toThrow(
      new PageScriptError(
        'page script failed (return boom();): TypeError: probe boom',
        'return boom();',
        'TypeError',
      ),
    );
    await expect(run).rejects.toBeInstanceOf(PageScriptError);
  });
});

describe('executeAsyncScript: a body that calls its last argument, awaited', () => {
  it('runs the body inside a promise handed resolve last, then awaits that promise by value', async () => {
    const page = fakePage({
      'Runtime.evaluate': [WINDOW],
      'Runtime.callFunctionOn': [recorded('promise handle')],
      'Runtime.awaitPromise': [recorded('Runtime.awaitPromise resolve')],
    });
    const value = await new PageDriver(page).executeAsyncScript(
      'setTimeout(function () { arguments[1]({ waited: arguments[0] }); }, 50);',
      [50],
    );
    expect(value).toEqual({ waited: 50 });
    const [, call, awaited] = page.sent;
    const params = call?.params as Record<string, unknown>;
    expect(params.returnByValue).toBeUndefined();
    expect(params.arguments).toEqual([{ value: 50 }]);
    expect(params.functionDeclaration).toContain('args.push(resolve);');
    expect(params.functionDeclaration).toContain(
      'setTimeout(function () { arguments[1]({ waited: arguments[0] }); }, 50);',
    );
    expect(awaited).toEqual({
      method: 'Runtime.awaitPromise',
      params: {
        promiseObjectId: '{"injectedScriptId":1,"id":1}',
        returnByValue: true,
      },
    });
  });

  it('turns a rejected promise into a PageScriptError naming the error', async () => {
    const page = fakePage({
      'Runtime.evaluate': [WINDOW],
      'Runtime.callFunctionOn': [recorded('rejecting handle')],
      'Runtime.awaitPromise': [recorded('Runtime.awaitPromise reject')],
    });
    await expect(
      new PageDriver(page).executeAsyncScript('throw new RangeError("x");'),
    ).rejects.toThrow(
      'page script failed (throw new RangeError("x");): RangeError: probe reject',
    );
  });

  it('refuses at once, awaiting nothing, when the page threw before a promise existed', async () => {
    const page = fakePage({
      'Runtime.evaluate': [WINDOW],
      'Runtime.callFunctionOn': [recorded('thrown error')],
    });
    await expect(
      new PageDriver(page).executeAsyncScript('boom();'),
    ).rejects.toBeInstanceOf(PageScriptError);
    expect(page.sent.map((sent) => sent.method)).not.toContain(
      'Runtime.awaitPromise',
    );
  });
});

const LIST_ENTRY = recorded(
  'getProperties on list (first entry; the log cut the answer at 300 chars)',
) as { value: { objectId: string } } & Record<string, unknown>;

/** A getProperties answer: the recorded entry as index 0, a second node, and `length`. */
const listOfTwo = {
  properties: [
    {
      ...LIST_ENTRY,
      name: '1',
      value: { ...LIST_ENTRY.value, objectId: 'node-1' },
    },
    { name: 'length', value: { type: 'number', value: 2 } },
    LIST_ENTRY,
  ],
};

const ELEMENT_ID = LIST_ENTRY.value.objectId;

function elementOn(answers: Record<string, unknown[]>) {
  const page = fakePage(answers);
  return { page, element: new PageElement(page, ELEMENT_ID, '#cg-go') };
}

describe('findElements: every element a selector matches, in document order', () => {
  it('lists the matches as an array handle and keeps only its index properties, in order', async () => {
    const page = fakePage({
      'Runtime.evaluate': [recorded('element list handle')],
      'Runtime.getProperties': [listOfTwo],
    });
    const found = await new PageDriver(page).findElements('a[href="/"]');
    expect(found.map((element) => element.objectId)).toEqual([
      ELEMENT_ID,
      'node-1',
    ]);
    expect(page.sent).toEqual([
      {
        method: 'Runtime.evaluate',
        params: {
          expression:
            'Array.from(document.querySelectorAll("a[href=\\"/\\"]"))',
        },
      },
      {
        method: 'Runtime.getProperties',
        params: {
          objectId: '{"injectedScriptId":1,"id":3}',
          ownProperties: true,
        },
      },
    ]);
  });

  it('findElement returns the first match', async () => {
    const page = fakePage({
      'Runtime.evaluate': [recorded('element list handle')],
      'Runtime.getProperties': [listOfTwo],
    });
    const element = await new PageDriver(page).findElement('a');
    expect(element.objectId).toBe(ELEMENT_ID);
  });

  it('findElement refuses a selector nothing matches, naming it', async () => {
    const page = fakePage({
      'Runtime.evaluate': [recorded('element list handle')],
      'Runtime.getProperties': [{ properties: [] }],
    });
    await expect(new PageDriver(page).findElement('#nope')).rejects.toThrow(
      'no element matches #nope',
    );
  });

  it('executeScript hands a found element to the script as its handle', async () => {
    const page = fakePage({
      'Runtime.evaluate': [WINDOW],
      'Runtime.callFunctionOn': [recorded('callFunctionOn handle')],
    });
    const element = new PageElement(page, ELEMENT_ID, 'a');
    await new PageDriver(page).executeScript('return arguments[0].id;', [
      element,
    ]);
    expect((page.sent[1]?.params as { arguments: unknown }).arguments).toEqual([
      { objectId: ELEMENT_ID },
    ]);
  });
});

/** The function an element call sent, and its arguments. */
function lastCall(page: ReturnType<typeof fakePage>) {
  const call = page.sent.at(-1);
  expect(call?.method).toBe('Runtime.callFunctionOn');
  const params = call?.params as {
    objectId: string;
    functionDeclaration: string;
    arguments: unknown[];
    returnByValue: boolean;
  };
  expect(params.objectId).toBe(ELEMENT_ID);
  expect(params.returnByValue).toBe(true);
  return params;
}

const done = { result: { type: 'undefined' }, wasThrown: false };
const valued = (value: unknown) => ({
  result: { type: typeof value, value },
  wasThrown: false,
});

describe('a PageElement: each call is one function run on the element itself', () => {
  it('click calls the element’s own click()', async () => {
    const { page, element } = elementOn({ 'Runtime.callFunctionOn': [done] });
    await element.click();
    expect(lastCall(page).functionDeclaration).toContain('this.click();');
  });

  it('clear empties the value, then fires input and change', async () => {
    const { page, element } = elementOn({ 'Runtime.callFunctionOn': [done] });
    await element.clear();
    const source = lastCall(page).functionDeclaration;
    expect(source).toContain("this.value = '';");
    expect(
      source.indexOf("new Event('input', { bubbles: true })"),
    ).toBeLessThan(source.indexOf("new Event('change', { bubbles: true })"));
  });

  it('sendKeys appends the text, then fires input and change', async () => {
    const { page, element } = elementOn({ 'Runtime.callFunctionOn': [done] });
    await element.sendKeys('Ana');
    const call = lastCall(page);
    expect(call.functionDeclaration).toContain(
      'this.value = this.value + arguments[0];',
    );
    expect(call.functionDeclaration).toContain(
      "new Event('change', { bubbles: true })",
    );
    expect(call.arguments).toEqual([{ value: 'Ana' }]);
  });

  it('text returns innerText', async () => {
    const { page, element } = elementOn({
      'Runtime.callFunctionOn': [valued('Groups')],
    });
    expect(await element.text()).toBe('Groups');
    expect(lastCall(page).functionDeclaration).toContain(
      'return this.innerText;',
    );
  });

  it('text refuses a value that is not a string, naming the selector', async () => {
    const { element } = elementOn({ 'Runtime.callFunctionOn': [valued(3)] });
    await expect(element.text()).rejects.toThrow(
      'expected the text of #cg-go to be a string, got 3',
    );
  });

  it('attribute returns getAttribute(name), null included', async () => {
    const { page, element } = elementOn({
      'Runtime.callFunctionOn': [
        {
          result: { type: 'object', subtype: 'null', value: null },
          wasThrown: false,
        },
      ],
    });
    expect(await element.attribute('aria-expanded')).toBeNull();
    const call = lastCall(page);
    expect(call.functionDeclaration).toContain(
      'return this.getAttribute(arguments[0]);',
    );
    expect(call.arguments).toEqual([{ value: 'aria-expanded' }]);
  });

  it('property returns this[name]', async () => {
    const { page, element } = elementOn({
      'Runtime.callFunctionOn': [valued(true)],
    });
    expect(await element.property('hidden')).toBe(true);
    const call = lastCall(page);
    expect(call.functionDeclaration).toContain('return this[arguments[0]];');
    expect(call.arguments).toEqual([{ value: 'hidden' }]);
  });

  it('rect returns a plain object of the bounding box', async () => {
    const box = { x: 1, y: 2, width: 30, height: 44 };
    const { page, element } = elementOn({
      'Runtime.callFunctionOn': [valued(box)],
    });
    expect(await element.rect()).toEqual(box);
    expect(lastCall(page).functionDeclaration).toContain(
      'return { x: r.x, y: r.y, width: r.width, height: r.height };',
    );
  });

  it('rect refuses a box missing a number, naming the selector', async () => {
    const { element } = elementOn({
      'Runtime.callFunctionOn': [valued({})],
    });
    await expect(element.rect()).rejects.toThrow(
      'expected the rect of #cg-go to hold x, y, width and height, got {}',
    );
  });

  it('a handle the page no longer knows is a StaleElementError naming the selector', async () => {
    const { element } = elementOn({
      'Runtime.callFunctionOn': [
        new Refusal('Missing injected script for given objectId'),
      ],
    });
    const click = element.click();
    await expect(click).rejects.toBeInstanceOf(StaleElementError);
    await expect(click).rejects.toThrow(
      'the element #cg-go found is gone from the page (it reloaded or was replaced)',
    );
  });

  it('any other refusal passes through as the InspectorError it was', async () => {
    const { element } = elementOn({
      'Runtime.callFunctionOn': [new Refusal('something else')],
    });
    await expect(element.click()).rejects.toBeInstanceOf(InspectorError);
  });

  it('an exception the element’s function threw is a PageScriptError', async () => {
    const { element } = elementOn({
      'Runtime.callFunctionOn': [recorded('thrown error')],
    });
    await expect(element.click()).rejects.toBeInstanceOf(PageScriptError);
  });
});

describe('a PageElement refuses answers of the wrong shape', () => {
  it('attribute refuses a value that is neither a string nor null', async () => {
    const { element } = elementOn({ 'Runtime.callFunctionOn': [valued(1)] });
    await expect(element.attribute('aria-expanded')).rejects.toThrow(
      'expected the aria-expanded attribute of #cg-go to be a string or null, got 1',
    );
  });

  it('findElements refuses an index entry that carries no handle', async () => {
    const page = fakePage({
      'Runtime.evaluate': [recorded('element list handle')],
      'Runtime.getProperties': [
        { properties: [{ name: '0', value: { type: 'undefined' } }] },
      ],
    });
    await expect(new PageDriver(page).findElements('a')).rejects.toThrow(
      'expected match 0 to come back as a handle, got {"type":"undefined"}',
    );
  });
});
