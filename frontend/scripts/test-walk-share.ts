import assert from 'node:assert/strict';
import { walkLink } from '../src/walkmode/walkLink';
import { roomTourUrl } from '../src/components/walkEntry';
import { walkShareMeta } from '../src/walkmode/shareMeta';

const name = '강남데시앙포레', id = '11680:수서동:795:강남데시앙포레';
const url = new URL(walkLink(37.5, 127.05, 7, { name, complexId: id }), 'https://kospimap.com');
assert.equal(url.searchParams.get('name'), name);
assert.equal(url.searchParams.get('id'), id);
assert.equal(url.searchParams.get('f'), '7');
assert.equal(walkShareMeta(url.searchParams).title, '강남데시앙포레 | 룸투어(임장) | KOSPIMAP');
assert.equal(walkShareMeta(new URLSearchParams({ id })).title, walkShareMeta(url.searchParams).title);
assert.equal(new URL(roomTourUrl('11680:123', 84, '/realestate-map', name), url).searchParams.get('name'), name);
assert.equal(walkShareMeta(new URLSearchParams()).title, '룸투어(임장) | KOSPIMAP');
assert.equal(walkLink(37.5, 127.05, -2), '/walk?at=37.500000,127.050000&f=-2');
console.log('PASS apartment names and destinations survive room-tour sharing');
