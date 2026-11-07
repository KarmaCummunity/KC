// @vitest-environment jsdom
// #1936 (store support URL, docs/spec/96 L4; FR-SETTINGS-018 direction): the public /support page
// shows one language at a time — Hebrew RTL by default, English LTR at /support#en — with no JS.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SUPPORT_HTML = readFileSync(path.resolve(__dirname, '../../../public/support.html'), 'utf8');

function openAt(hash: '' | '#he' | '#en') {
  const doc = new DOMParser().parseFromString(SUPPORT_HTML, 'text/html');
  document.replaceChild(document.adoptNode(doc.documentElement), document.documentElement);
  window.location.hash = hash;
  const section = (lang: 'he' | 'en') => document.getElementById(lang) as HTMLElement;
  const isVisible = (lang: 'he' | 'en') => window.getComputedStyle(section(lang)).display !== 'none';
  return { window, section, isVisible };
}

describe('public support page language toggle (#1936)', () => {
  it('shows only the Hebrew section by default', () => {
    const page = openAt('');
    expect(page.isVisible('he')).toBe(true);
    expect(page.isVisible('en')).toBe(false);
  });

  it('shows only the Hebrew section at #he', () => {
    const page = openAt('#he');
    expect(page.isVisible('he')).toBe(true);
    expect(page.isVisible('en')).toBe(false);
  });

  it('shows only the English section at #en', () => {
    const page = openAt('#en');
    expect(page.isVisible('en')).toBe(true);
    expect(page.isVisible('he')).toBe(false);
  });

  it('gives each section its own direction and a toggle to the other language', () => {
    const page = openAt('');
    expect(page.section('he').getAttribute('dir')).toBe('rtl');
    expect(page.section('en').getAttribute('dir')).toBe('ltr');
    expect(page.section('he').querySelector('nav a[href="#en"]')).not.toBeNull();
    expect(page.section('en').querySelector('nav a[href="#he"]')).not.toBeNull();
  });

  it('has no visible separator left over from the stacked layout', () => {
    expect(openAt('').window.document.querySelector('body > hr')).toBeNull();
  });
});
