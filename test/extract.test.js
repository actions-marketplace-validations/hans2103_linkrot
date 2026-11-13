import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLinks } from '../src/extract.js';

const PAGE = 'https://ex.com/';
const urls = (html, page = PAGE) => extractLinks(html, page).map((l) => l.url);
const kinds = (html, page = PAGE) => extractLinks(html, page).map((l) => l.kind);

test('maps elements to link kinds', () => {
  const html = `
    <a href="/a">a</a>
    <img src="/i.png">
    <script src="/s.js"></script>
    <link rel="stylesheet" href="/c.css">
    <iframe src="/f"></iframe>
    <video src="/v.mp4"><source src="/v2.mp4"></video>
    <audio src="/au.mp3"></audio>`;
  assert.deepEqual(extractLinks(html, PAGE), [
    { url: 'https://ex.com/a', kind: 'a' },
    { url: 'https://ex.com/i.png', kind: 'img' },
    { url: 'https://ex.com/s.js', kind: 'script' },
    { url: 'https://ex.com/c.css', kind: 'stylesheet' },
    { url: 'https://ex.com/f', kind: 'iframe' },
    { url: 'https://ex.com/v.mp4', kind: 'media' },
    { url: 'https://ex.com/v2.mp4', kind: 'media' },
    { url: 'https://ex.com/au.mp3', kind: 'media' },
  ]);
});

test('srcset is split on comma+whitespace only', () => {
  const html = `<img srcset="https://ik.imagekit.io/x/tr:w-320,q-80,f-auto/a.jpg 320w, https://ik.imagekit.io/x/tr:w-480,q-80/a.jpg 480w">`;
  assert.deepEqual(extractLinks(html, PAGE), [
    { url: 'https://ik.imagekit.io/x/tr:w-320,q-80,f-auto/a.jpg', kind: 'srcset' },
    { url: 'https://ik.imagekit.io/x/tr:w-480,q-80/a.jpg', kind: 'srcset' },
  ]);
});

test('base href is used to resolve relative links', () => {
  const html = `<base href="https://ex.com/sub/"><a href="p">p</a>`;
  assert.deepEqual(urls(html), ['https://ex.com/sub/p']);
});

test('non-HTTP schemes and bare fragments are dropped', () => {
  const html = ['#top', 'mailto:a@b.nl', 'tel:+31', 'webcal://x/c.ics', 'javascript:void(0)', 'data:text/plain,hi']
    .map((h) => `<a href="${h}">x</a>`)
    .join('');
  assert.deepEqual(urls(html), []);
});

test('fragments are stripped and duplicates removed, first kind wins', () => {
  assert.deepEqual(urls('<a href="/x#frag">1</a><a href="/x">2</a>'), ['https://ex.com/x']);
  assert.deepEqual(kinds('<img src="/x"><a href="/x">1</a>'), ['img']);
});

test('canonical, alternate hreflang and og:url get their own kinds', () => {
  const html = `
    <link rel="canonical" href="/c">
    <link rel="alternate" hreflang="nl" href="/nl">
    <meta property="og:url" content="/og">`;
  assert.deepEqual(extractLinks(html, PAGE), [
    { url: 'https://ex.com/c', kind: 'canonical' },
    { url: 'https://ex.com/nl', kind: 'alternate' },
    { url: 'https://ex.com/og', kind: 'og' },
  ]);
});

test('other link rels become other', () => {
  assert.deepEqual(kinds('<link rel="icon" href="/f.ico">'), ['other']);
});

test('HTML entities in attributes are decoded', () => {
  assert.deepEqual(urls('<a href="/q?a=1&amp;b=2">x</a>'), ['https://ex.com/q?a=1&b=2']);
});

test('resource hints are not links: preconnect, dns-prefetch, prefetch, prerender, pingback', () => {
  const html = `
    <link rel="preconnect" href="https://fonts.gstatic.com/" crossorigin>
    <link rel="DNS-Prefetch" href="//cdn.example/">
    <link rel="prefetch" href="/next">
    <link rel="prerender" href="/later">
    <link rel="pingback" href="/xmlrpc.php">
    <link rel="preconnect dns-prefetch" href="https://both.example/">`;
  assert.deepEqual(urls(html), []);
});

test('preload, icon and manifest links are still checked', () => {
  const html = `
    <link rel="preload" href="/font.woff2" as="font">
    <link rel="icon" href="/f.ico">
    <link rel="manifest" href="/site.webmanifest">`;
  assert.deepEqual(urls(html), ['https://ex.com/font.woff2', 'https://ex.com/f.ico', 'https://ex.com/site.webmanifest']);
});
