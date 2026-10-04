import '@testing-library/jest-dom/vitest';
import '../lib/zod';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

// jsdom no trae estas APIs del navegador que usan Radix, cmdk e input-otp.
function stub(target: object, name: string, value: unknown) {
  if (typeof (target as Record<string, unknown>)[name] !== 'function') {
    Object.defineProperty(target, name, { value, configurable: true, writable: true });
  }
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
stub(globalThis, 'ResizeObserver', ResizeObserverStub);
stub(Element.prototype, 'scrollIntoView', () => undefined);
stub(Element.prototype, 'hasPointerCapture', () => false);
stub(Element.prototype, 'releasePointerCapture', () => undefined);
stub(document, 'elementFromPoint', () => null);
stub(window, 'matchMedia', (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
}));
