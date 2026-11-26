import test from 'node:test';
import assert from 'node:assert/strict';
import { groupUrl, hostPermission, inGroup, matchesPattern, normalizedText, validateRule } from '../src/core';

test('URL rules and safe group boundaries for a reusable PR rule', () => {
  const pattern = 'https://github.com/**/pull/**';
  assert.equal(matchesPattern(pattern, 'https://github.com/owner/repo/pull/118/commits?diff=1#top'), true);
  for (const url of ['https://other.com/owner/repo/pull/118', 'https://github.com.evil.test/owner/repo/pull/118', 'http://github.com/owner/repo/pull/118', 'chrome://extensions']) assert.equal(matchesPattern(pattern, url), false);
  assert.equal(matchesPattern('https://example.com/a/*', 'https://example.com/a/b/c'), false);
  assert.equal(matchesPattern('https://example.com/a.b/**', 'https://example.com/axb/1'), false);
  assert.equal(hostPermission('https://example.com:8443/**'), 'https://example.com/*');
  const base = groupUrl('https://github.com/owner/repo/pull/118/commits?q=1#top', 4)!;
  assert.equal(base, 'https://github.com/owner/repo/pull/118');
  assert.equal(groupUrl('https://github.com/owner', 4), null);
  for (const suffix of ['', '/', '/commits', '/changes?x=1', '?x=1#top']) assert.equal(inGroup(base + suffix, base), true);
  for (const url of [base + '0', base.replace('/owner/', '/other/'), base.replace('github.com', 'elsewhere.test'), base.replace('/118', '/119')]) assert.equal(inGroup(url, base), false);
  assert.equal(normalizedText('  Merged\n  now '), 'Merged now');
  assert.throws(() => validateRule({}));
});

test('rule types: legacy rules close; keep-duplicates rules need only a name and pattern', () => {
  const legacy = { id: 'a', name: 'PRs', pattern: 'https://github.com/**', selector: '#s', text: 'Merged', baseDepth: 4, closeRelated: true, enabled: true };
  assert.equal(validateRule(legacy).type, 'close');
  assert.deepEqual(validateRule({ id: 'b', type: 'keepDuplicates', name: ' Docs ', pattern: 'https://example.com/**', enabled: true, selector: 'x' }),
    { id: 'b', type: 'keepDuplicates', name: 'Docs', pattern: 'https://example.com/**', selector: '', text: '', baseDepth: 0, closeRelated: false, enabled: true });
  assert.throws(() => validateRule({ id: 'c', type: 'keepDuplicates', name: 'Bad', pattern: 'example.com', enabled: true }));
  assert.throws(() => validateRule({ ...legacy, type: 'other' }));
});
