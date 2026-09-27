import test from 'node:test';
import assert from 'node:assert/strict';
import { filterGroups, validateEnquiry } from '../src/lib/matching.mjs';
const groups = [
  { id: 'kids', min: 4, max: 6, time: '15:00', dayType: 'weekdays', style: 'Mix' },
  { id: 'teen', min: 12, time: '17:00', dayType: 'weekdays', style: 'Girls' },
  { id: 'unknown', min: null, time: '12:00', dayType: 'weekend', style: 'Hip-Hop' },
  { id: 'adult', min: 18, adult: true, time: '20:00', dayType: 'weekdays', style: 'Jazz' },
];
test('precise age does not recommend older or unknown-age groups', () => assert.deepEqual(filterGroups(groups, { age: '5' }).map(g => g.id), ['kids']));
test('age band uses overlap and keeps adults separate', () => assert.deepEqual(filterGroups(groups, { age: '11-14' }).map(g => g.id), ['teen']));
test('17:00 belongs to late slot and time/style filters combine', () => assert.deepEqual(filterGroups(groups, { age: '12', day: 'late', style: 'Girls' }).map(g => g.id), ['teen']));
test('empty results are not replaced with unrelated groups', () => assert.equal(filterGroups(groups, { age: '5', day: 'weekend' }).length, 0));
test('adult list only includes explicitly adult groups', () => assert.deepEqual(filterGroups(groups, { adult: true }).map(g => g.id), ['adult']));
const valid = { name: 'Тест', phone: '+7 (999) 000-00-00', age: '7', consent: true, group: 'Mix' };
test('valid enquiry accepts formatted phone', () => assert.equal(validateEnquiry(valid), null));
test('rejects absent consent, malformed phone and unsupported age', () => {
  assert.ok(validateEnquiry({ ...valid, consent: false })); assert.ok(validateEnquiry({ ...valid, phone: '123' })); assert.ok(validateEnquiry({ ...valid, age: 2 }));
});
