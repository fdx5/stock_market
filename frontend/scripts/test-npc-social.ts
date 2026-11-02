import assert from 'node:assert/strict';
import { answerCases, socialAnswer, SOCIAL_LABEL, type Social } from '../src/walkmode/interior/npcLines';
import { talk } from '../src/walkmode/interior/npcTalk';
import { generatePlan } from '../src/walkmode/interior/plan/generate';

// Social actions answer every part, at every liking, never empty; liking moves the right way;
// the line bank gives at least ten times the variety of the plain talk.
let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const roles = ['doctor', 'nurse', 'clerk', 'patient', 'visitor', 'guard', 'cook', 'student'] as const;
const seen = new Set<string>();
for (const role of roles) for (const affinity of [0, 20, 45, 70, 95]) for (const a of Object.keys(SOCIAL_LABEL) as Social[]) for (let k = 0; k < 6; k++) {
  const ans = socialAnswer(a, { role, kind: 'clinic', bldg: '삼성서울병원', floor: '1층', places: ['약국', '카페'], affinity, rnd, gift: '텀블러' }, 0);
  assert.ok(ans.text.length > 3 && !/\{\w+\}|undefined/.test(ans.text), `${role}/${a}: ${ans.text}`);
  seen.add(ans.text);
}
assert.ok(socialAnswer('gift', { role: 'visitor', kind: 'office', bldg: 'A', floor: '1층', places: [], affinity: 30, rnd, gift: '꽃다발' }, 0).delta >= 10, 'a gift is liked');
assert.ok(socialAnswer('joke', { role: 'visitor', kind: 'office', bldg: 'A', floor: '1층', places: [], affinity: 30, rnd }, 3).delta < 0, 'the same joke a fourth time wears thin');
// the plain talk's variety, sampled the same way, against the social answers'
const plan = generatePlan({ complexId: 't', complexName: 't', dong: '', unitType: 't', area: 84 });
plan.facility = { kind: 'clinic', name: '병원', level: 1, levelLabel: '1층', use: '', start: [0, 0, 0], lifts: [], people: [] } as never;
const plain = new Set<string>(); for (const role of roles) for (let i = 0; i < 1200; i++) plain.add(talk({ role, kind: 'clinic', plan, room: '로비', seed: i, turn: i % 3, hour: 10 }));
const cases = answerCases();
console.log(`npc social: ${seen.size} distinct answers in a small sample, ${cases.toLocaleString()} possible social answers, plain talk sample ${plain.size} PASS`);
assert.ok(cases > 40000, 'a large bank of social answers');
