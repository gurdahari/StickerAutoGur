import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getNichePromptScope,
  getPrimarySubjectScopeInstruction,
  getScopedFallbackFamily
} from '../services/nichePromptScope';

test('extracts a mandatory primary-subject scope from a generation brief', () => {
  const scope = getNichePromptScope('Theme universe: pets. NON-NEGOTIABLE PRIMARY SUBJECT: a living animal.');
  assert.deepEqual(scope, { primarySubject: 'a living animal' });
});

test('primary-subject scope rejects standalone supporting objects', () => {
  const scope = getNichePromptScope('NON-NEGOTIABLE PRIMARY SUBJECT: a living animal.');
  assert.match(getPrimarySubjectScopeInstruction(scope), /standalone supporting object is out of scope and invalid/i);
  assert.match(getScopedFallbackFamily(scope) || '', /a living animal as the main subject/i);
});

test('unscoped niches preserve the generic prompt path', () => {
  const scope = getNichePromptScope('Theme universe: calendars, appointments and habits.');
  assert.equal(scope, null);
  assert.equal(getPrimarySubjectScopeInstruction(scope), '');
  assert.equal(getScopedFallbackFamily(scope), null);
});
