import test from 'node:test';
import assert from 'node:assert/strict';
import { backupNudge } from '../js/notices.js';

const DAY = 86400000, NOW = 1_800_000_000_000;
test('sin datos no hay recordatorio', () => assert.equal(backupNudge(null, false, NOW), null));
test('con datos y nunca respaldado: recordatorio', () => assert.deepEqual(backupNudge(null, true, NOW), { never: true, days: null }));
test('respaldo reciente: sin recordatorio', () => assert.equal(backupNudge(NOW - 30 * DAY, true, NOW), null));
test('respaldo de más de 30 días: recordatorio con días', () => assert.deepEqual(backupNudge(NOW - 45 * DAY, true, NOW), { never: false, days: 45 }));
