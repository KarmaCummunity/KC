// @vitest-environment jsdom
// #1941 (follow-up to #1936; FR-SETTINGS-018 direction): the public legal pages show one language at
// a time — Hebrew RTL by default, English LTR at "<page>#en" — with a CSS-only :target toggle (no JS).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const LEGAL_PAGES = ['privacy', 'terms', 'delete-account', 'child-safety'] as const;

type Lang = 'he' | 'en';

/** Loads a static page into the jsdom document and applies the given URL hash, as a browser would. */
function openAt(page: (typeof LEGAL_PAGES)[number], hash: '' | '#he' | '#en') {
  const html = readFileSync(path.resolve(__dirname, `../../../public/${page}.html`), 'utf8');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  document.replaceChild(document.adoptNode(doc.documentElement), document.documentElement);
  window.location.hash = hash;
  const section = (lang: Lang) => document.getElementById(lang) as HTMLElement;
  // jsdom resolves :target rules in getComputedStyle, so this reflects what a visitor would see.
  const isVisible = (lang: Lang) => window.getComputedStyle(section(lang)).display !== 'none';
  return { section, isVisible };
}

describe.each(LEGAL_PAGES)('public /%s page language toggle (#1941)', (page) => {
  it('shows only the Hebrew section by default', () => {
    const view = openAt(page, '');
    expect(view.isVisible('he')).toBe(true);
    expect(view.isVisible('en')).toBe(false);
  });

  it('shows only the Hebrew section at #he', () => {
    const view = openAt(page, '#he');
    expect(view.isVisible('he')).toBe(true);
    expect(view.isVisible('en')).toBe(false);
  });

  it('shows only the English section at #en, so existing #en deep links keep working', () => {
    const view = openAt(page, '#en');
    expect(view.isVisible('en')).toBe(true);
    expect(view.isVisible('he')).toBe(false);
  });

  it('gives each section its own direction and a toggle to the other language', () => {
    const view = openAt(page, '');
    expect(view.section('he').getAttribute('dir')).toBe('rtl');
    expect(view.section('en').getAttribute('dir')).toBe('ltr');
    expect(view.section('he').querySelector('nav a[href="#en"]')).not.toBeNull();
    expect(view.section('en').querySelector('nav a[href="#he"]')).not.toBeNull();
  });

  it('has no separator left over from the stacked layout', () => {
    openAt(page, '');
    expect(document.querySelector('body > hr')).toBeNull();
  });
});
