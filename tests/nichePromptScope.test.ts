import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNicheConceptScope,
  getCollectionContractInstruction,
  getContractBoundFallbackFamily
} from '../services/nichePromptScope';

test('builds the contract from the niche analysis instead of preset markers', () => {
  const scope = createNicheConceptScope('submitted brief', {
    themeUniverse: 'original fantasy worlds',
    collectionPromise: 'A character-led fantasy creature collection',
    membershipRule: 'The dominant subject must be an original fantasy creature.',
    allowedPrimarySubjects: 'dragons, griffins, sea creatures',
    supportingOnlySubjects: 'castles, potions, maps and scenery'
  });
  assert.deepEqual(scope, {
    collectionPromise: 'A character-led fantasy creature collection',
    membershipRule: 'The dominant subject must be an original fantasy creature.',
    allowedPrimarySubjects: 'dragons, griffins, sea creatures',
    supportingOnlySubjects: 'castles, potions, maps and scenery'
  });
});

test('the contract makes membership higher priority than variety', () => {
  const scope = createNicheConceptScope('functional calendar icons', {
    membershipRule: 'The subject must communicate a usable planning action at thumbnail size.'
  });
  const instruction = getCollectionContractInstruction(scope);
  assert.match(instruction, /binary membership test/i);
  assert.match(instruction, /variety, style and count never override this contract/i);
});

test('older analyses receive a conservative general fallback contract', () => {
  const scope = createNicheConceptScope('coastal travel');
  assert.match(scope.membershipRule, /primary visual subject directly and unmistakably represents coastal travel/i);
  assert.match(getContractBoundFallbackFamily(scope, 'lighthouses'), /must pass this membership test/i);
});
