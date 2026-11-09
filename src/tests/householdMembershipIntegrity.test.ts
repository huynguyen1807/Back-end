import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
import { HouseholdMember } from '../models/householdMember.model';
import { HouseholdInvitation } from '../models/householdInvitation.model';

const id = (value: number) => value.toString(16).padStart(24, '0');
const OWNER = id(1), USER = id(2), OTHER = id(3), HOUSE = id(10), INVITE = id(20), MEMBER = id(30);
type Row = Record<string, any>;
type State = Record<string, Row[]>;
const clone = <T>(value: T): T => structuredClone(value);

function matches(row: Row, query: Row) {
  return Object.entries(query).every(([key, value]) => {
    const actual = row[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.entries(value).every(([operator, target]) => {
        if (operator === '$ne') return String(actual) !== String(target);
        if (operator === '$gt') return actual > (target as any);
        if (operator === '$lte') return actual <= (target as any);
        throw new Error(`Unsupported test query: ${operator}`);
      });
    }
    return String(actual) === String(value);
  });
}

function harness() {
  let state: State = {
    users: [{ _id: OWNER, email: 'owner@test.invalid', status: 'ACTIVE' }, { _id: USER, email: 'member@test.invalid', status: 'ACTIVE' }, { _id: OTHER, email: 'other@test.invalid', status: 'ACTIVE' }],
    households: [{ _id: HOUSE, ownerId: OWNER, status: 'ACTIVE', membershipRevision: 0 }],
    members: [{ _id: MEMBER, householdId: HOUSE, userId: OWNER, role: 'OWNER', status: 'ACTIVE', permission: {} }],
    invitations: [{ _id: INVITE, householdId: HOUSE, inviteEmail: 'member@test.invalid', status: 'PENDING', expiresAt: new Date(Date.now() + 86400000) }],
    foods: [{ _id: id(40), ownerType: 'USER', userId: USER }],
    locations: [{ _id: id(50), ownerType: 'USER', userId: USER }],
  };
  const session = { testSession: true };
  const writes: string[] = [];
  let failure = '';
  let paid = true;
  let maxMembers = 6;
  let sequence = 100;
  let queue: Promise<unknown> = Promise.resolve();
  const verifySession = (table: string, options: any) => {
    // Existing expiry housekeeping is the only intentionally nontransactional write.
    if (!(table === 'invitations' && !options?.session)) assert.equal(options?.session, session);
  };
  const checkpoint = (name: string) => {
    writes.push(name);
    if (failure === name) throw new Error(`Injected failure: ${name}`);
  };
  function apply(row: Row, update: Row) {
    for (const [key, value] of Object.entries(update)) {
      if (key === '$set') Object.assign(row, clone(value));
      else if (key === '$unset') for (const field of Object.keys(value)) delete row[field];
      else if (key === '$inc') for (const [field, amount] of Object.entries(value)) row[field] = (row[field] ?? 0) + Number(amount);
      else row[key] = clone(value);
    }
  }
  function document(table: string, row?: Row): any {
    if (!row) return null;
    return Object.assign(clone(row), {
      async save(this: Row, options: any) {
        verifySession(table, options);
        const { save: _save, ...fields } = this;
        state[table][state[table].findIndex((item) => item._id === fields._id)] = clone(fields);
        checkpoint(`${table}.save`);
      },
    });
  }
  function model(table: string) {
    return {
      async findOne(query: Row) { return document(table, state[table].find((row) => matches(row, query))); },
      async findById(key: string) { return document(table, state[table].find((row) => row._id === key)); },
      countDocuments(query: Row) { return { async session(value: unknown) { assert.equal(value, session); return state[table].filter((row) => matches(row, query)).length; } }; },
      async create(rows: Row[], options: any) {
        verifySession(table, options);
        assert.ok(Array.isArray(rows));
        const created = rows.map((row) => ({ _id: id(sequence++), ...clone(row) }));
        state[table].push(...created);
        checkpoint(`${table}.create`);
        return created.map((row) => document(table, row));
      },
      async findOneAndUpdate(query: Row, update: Row, options: any) {
        verifySession(table, options);
        const row = state[table].find((item) => matches(item, query));
        if (!row) return null;
        apply(row, update);
        checkpoint(`${table}.findOneAndUpdate`);
        return document(table, row);
      },
      async findByIdAndUpdate(key: string, update: Row, options: any) {
        verifySession(table, options);
        const row = state[table].find((item) => item._id === key);
        if (!row) return null;
        apply(row, update);
        checkpoint(`${table}.findByIdAndUpdate`);
        return document(table, row);
      },
      async updateMany(query: Row, update: Row, options?: any) {
        verifySession(table, options);
        for (const row of state[table].filter((item) => matches(item, query))) apply(row, update);
        checkpoint(`${table}.updateMany`);
      },
    };
  }
  const mongoose = {
    Types: { ObjectId: { isValid: (value: string) => /^[a-f\d]{24}$/i.test(value) } },
    connection: {
      // This fake verifies transaction boundaries and rollback logic. It does
      // not emulate MongoDB write conflicts, indexes or driver retry semantics.
      transaction(operation: (session: unknown) => Promise<unknown>) {
        const result = queue.catch(() => {}).then(async () => {
          const snapshot = clone(state);
          try { return await operation(session); }
          catch (error) { state = snapshot; throw error; }
        });
        queue = result;
        return result;
      },
    },
  };
  const dependencies: Record<string, any> = {
    crypto, mongoose,
    './subscriptionService': { assertHouseholdSharedAccess: async () => {
      if (!paid) throw new Error('Family Cloud requires an active household subscription');
      return { hasPaidAccess: true, limits: { maxMembers } };
    } },
  };
  for (const [file, name, table] of [
    ['household', 'Household', 'households'], ['householdMember', 'HouseholdMember', 'members'],
    ['householdInvitation', 'HouseholdInvitation', 'invitations'], ['user', 'User', 'users'],
    ['foodItem', 'FoodItem', 'foods'], ['storageLocation', 'StorageLocation', 'locations'],
  ]) dependencies[`../models/${file}.model`] = { [name]: model(table) };
  const filename = path.resolve(__dirname, '../services/householdService.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const module = { exports: {} as any };
  vm.runInNewContext(compiled.outputText, { module, exports: module.exports, require: (name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`);
    return dependencies[name];
  } }, { filename });
  return { api: module.exports, state: () => state, writes, fail: (name: string) => { failure = name; },
    entitlement: (active: boolean, memberLimit = 6) => { paid = active; maxMembers = memberLimit; } };
}

test('accept commits membership, original inventory transfer and invitation together', async () => {
  const h = harness();
  const member = await h.api.acceptHouseholdInvitation(USER, INVITE);
  assert.equal(member.role, 'MEMBER');
  assert.equal(h.state().invitations[0].status, 'ACCEPTED');
  for (const row of [h.state().foods[0], h.state().locations[0]]) {
    assert.equal(row.ownerType, 'HOUSEHOLD'); assert.equal(row.householdId, HOUSE); assert.equal(row.userId, undefined);
  }
});

test('inviting an unknown or inactive account returns a specific 404 without creating an invitation', async () => {
  for (const inactive of [false, true]) {
    const h = harness(); if (inactive) h.state().users.find(row => row._id === OTHER)!.status = 'INACTIVE';
    const before = h.state().invitations.length;
    await assert.rejects(h.api.addHouseholdMember(HOUSE, OWNER, { email: inactive ? 'other@test.invalid' : 'missing@test.invalid' }),
      (error: any) => error.statusCode === 404 && /FreshFriends/.test(error.message));
    assert.equal(h.state().invitations.length, before); assert.equal(h.state().households[0].membershipRevision, 0);
  }
});

test('invitation email is normalized and malformed input is rejected before writing', async () => {
  const h = harness();
  await assert.rejects(h.api.addHouseholdMember(HOUSE, OWNER, { email: 'not-an-email' }), (error: any) => error.statusCode === 400);
  assert.equal(h.state().households[0].membershipRevision, 0);
  const result = await h.api.addHouseholdMember(HOUSE, OWNER, { email: '  OTHER@TEST.INVALID  ' });
  assert.equal(result.invitation.inviteEmail, 'other@test.invalid');
});

for (const checkpoint of ['members.create', 'locations.updateMany', 'foods.updateMany']) {
  test(`accept rolls back all writes if ${checkpoint} fails`, async () => {
    const h = harness(); const before = clone(h.state()); h.fail(checkpoint);
    await assert.rejects(h.api.acceptHouseholdInvitation(USER, INVITE), /Injected failure/);
    assert.deepEqual(h.state(), before);
  });
}

test('another user cannot accept or reject an invitation', async () => {
  const h = harness(); const before = clone(h.state());
  await assert.rejects(h.api.acceptHouseholdInvitation(OTHER, INVITE), /not found/);
  await assert.rejects(h.api.rejectHouseholdInvitation(OTHER, INVITE), /not found/);
  assert.deepEqual(h.state(), before);
});

test('expired invitation cannot create membership or transfer inventory', async () => {
  const h = harness(); h.state().invitations[0].expiresAt = new Date(Date.now() - 1000);
  await assert.rejects(h.api.acceptHouseholdInvitation(USER, INVITE), (error: any) => error.statusCode === 410);
  assert.equal(h.state().invitations[0].status, 'EXPIRED');
  assert.equal(h.state().members.length, 1); assert.equal(h.state().foods[0].ownerType, 'USER');
});

test('accepting at six reserved slots replaces its own invitation reservation', async () => {
  const h = harness();
  for (let n = 0; n < 4; n++) h.state().members.push({ _id: id(200 + n), userId: id(300 + n), householdId: HOUSE, role: 'MEMBER', status: 'ACTIVE' });
  await h.api.acceptHouseholdInvitation(USER, INVITE);
  assert.equal(h.state().members.filter((row) => row.status === 'ACTIVE').length, 6);
});

test('accept rejects over-capacity without transferring inventory', async () => {
  const h = harness();
  for (let n = 0; n < 5; n++) h.state().members.push({ _id: id(200 + n), userId: id(300 + n), householdId: HOUSE, role: 'MEMBER', status: 'ACTIVE' });
  await assert.rejects(h.api.acceptHouseholdInvitation(USER, INVITE), /limit reached/);
  assert.equal(h.state().invitations[0].status, 'PENDING'); assert.equal(h.state().foods[0].ownerType, 'USER');
});

test('invitation creation counts active members and other unexpired reservations', async () => {
  const h = harness();
  for (let n = 0; n < 4; n++) h.state().members.push({ _id: id(200 + n), userId: id(300 + n), householdId: HOUSE, role: 'MEMBER', status: 'ACTIVE' });
  await assert.rejects(h.api.addHouseholdMember(HOUSE, OWNER, { email: 'other@test.invalid' }), /limit reached/);
});

test('replaying acceptance cannot transfer inventory or create another active membership', async () => {
  const h = harness(); await h.api.acceptHouseholdInvitation(USER, INVITE);
  const before = clone(h.state());
  await assert.rejects(h.api.acceptHouseholdInvitation(USER, INVITE), /no longer pending/);
  assert.deepEqual(h.state(), before);
});

test('duplicate accept requests have one winner in the serialized transaction model', async () => {
  const h = harness();
  const results = await Promise.allSettled([
    h.api.acceptHouseholdInvitation(USER, INVITE), h.api.acceptHouseholdInvitation(USER, INVITE),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(h.state().members.filter((row) => row.userId === USER && row.status === 'ACTIVE').length, 1);
  assert.equal(h.writes.filter((write) => write === 'foods.updateMany').length, 1);
});

test('accept versus cancel has one terminal state in the serialized transaction model', async () => {
  const h = harness();
  const results = await Promise.allSettled([
    h.api.acceptHouseholdInvitation(USER, INVITE), h.api.cancelHouseholdInvitation(HOUSE, OWNER, INVITE),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const accepted = h.state().invitations[0].status === 'ACCEPTED';
  assert.equal(h.state().members.some((row) => row.userId === USER && row.status === 'ACTIVE'), accepted);
  assert.equal(h.state().foods[0].ownerType, accepted ? 'HOUSEHOLD' : 'USER');
});

test('two invitations cannot reserve the same last slot in the serialized transaction model', async () => {
  const h = harness(); h.state().invitations = [];
  for (let n = 0; n < 4; n++) h.state().members.push({ _id: id(200 + n), userId: id(300 + n), householdId: HOUSE, role: 'MEMBER', status: 'ACTIVE' });
  const results = await Promise.allSettled([
    h.api.addHouseholdMember(HOUSE, OWNER, { userId: USER }),
    h.api.addHouseholdMember(HOUSE, OWNER, { userId: OTHER }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(h.state().invitations.length, 1);
});

test('existing active membership in another household prevents acceptance', async () => {
  const h = harness(); h.state().members.push({ _id: id(300), userId: USER, householdId: id(11), role: 'MEMBER', status: 'ACTIVE' });
  await assert.rejects(h.api.acceptHouseholdInvitation(USER, INVITE), /already belongs/);
  assert.equal(h.state().invitations[0].status, 'PENDING');
});

test('removed membership is reactivated without creating a duplicate pair', async () => {
  const h = harness(); h.state().members.push({ _id: id(300), userId: USER, householdId: HOUSE, role: 'MEMBER', status: 'REMOVED' });
  await h.api.acceptHouseholdInvitation(USER, INVITE);
  assert.equal(h.state().members.length, 2); assert.equal(h.state().members[1].status, 'ACTIVE');
});

test('accept followed by cancel/reject cannot overwrite ACCEPTED', async () => {
  const h = harness(); await h.api.acceptHouseholdInvitation(USER, INVITE);
  await assert.rejects(h.api.cancelHouseholdInvitation(HOUSE, OWNER, INVITE), /no longer pending/);
  await assert.rejects(h.api.rejectHouseholdInvitation(USER, INVITE), /not found/);
  assert.equal(h.state().invitations[0].status, 'ACCEPTED');
});

test('cancel/reject followed by accept cannot create a membership', async () => {
  for (const operation of ['cancel', 'reject']) {
    const h = harness();
    if (operation === 'cancel') await h.api.cancelHouseholdInvitation(HOUSE, OWNER, INVITE);
    else await h.api.rejectHouseholdInvitation(USER, INVITE);
    await assert.rejects(h.api.acceptHouseholdInvitation(USER, INVITE), /no longer pending/);
    assert.equal(h.state().members.length, 1);
  }
});

test('owner cannot be removed, demoted, or stripped of management permissions', async () => {
  const h = harness();
  await assert.rejects(h.api.removeHouseholdMember(HOUSE, OWNER, MEMBER), /Owner cannot be removed/);
  await assert.rejects(h.api.updateHouseholdMember(HOUSE, OWNER, MEMBER, { role: 'MEMBER' }), /demoted/);
  await h.api.updateHouseholdMember(HOUSE, OWNER, MEMBER, { permission: { canInviteMember: false, canEditInventory: false } });
  assert.equal(h.state().members[0].role, 'OWNER');
  assert.equal(h.state().members[0].permission.canInviteMember, true);
  assert.equal(h.state().members[0].permission.canEditInventory, true);
});

test('OWNER role without matching household.ownerId cannot manage members', async () => {
  const h = harness(); h.state().households[0].ownerId = OTHER;
  await assert.rejects(h.api.removeHouseholdMember(HOUSE, OWNER, MEMBER), (error: any) => error.statusCode === 403);
});

test('a non-owner cannot invite, cancel, update, remove or delete the household', async () => {
  for (const operation of [
    (api: any) => api.addHouseholdMember(HOUSE, OTHER, { userId: USER }),
    (api: any) => api.cancelHouseholdInvitation(HOUSE, OTHER, INVITE),
    (api: any) => api.updateHouseholdMember(HOUSE, OTHER, MEMBER, { permission: {} }),
    (api: any) => api.removeHouseholdMember(HOUSE, OTHER, MEMBER),
    (api: any) => api.deleteHousehold(HOUSE, OTHER),
  ]) {
    const h = harness(); const before = clone(h.state());
    await assert.rejects(operation(h.api), (error: any) => error.statusCode === 403);
    assert.deepEqual(h.state(), before);
  }
});

test('a member can be removed without changing the agreed shared-inventory ownership', async () => {
  const h = harness(); const member = await h.api.acceptHouseholdInvitation(USER, INVITE);
  await h.api.removeHouseholdMember(HOUSE, OWNER, member._id);
  assert.equal(h.state().members.find((row) => row.userId === USER)?.status, 'REMOVED');
  assert.equal(h.state().foods[0].ownerType, 'HOUSEHOLD');
});

test('failure saving a member permission update rolls back its data and revision', async () => {
  const h = harness(); const member = await h.api.acceptHouseholdInvitation(USER, INVITE);
  const before = clone(h.state()); h.fail('members.save');
  await assert.rejects(h.api.updateHouseholdMember(HOUSE, OWNER, member._id, { permission: { canEditInventory: false } }), /Injected failure/);
  assert.deepEqual(h.state(), before);
});

test('invitation insertion failure rolls back the capacity revision', async () => {
  const h = harness(); const before = clone(h.state()); h.fail('invitations.create');
  await assert.rejects(h.api.addHouseholdMember(HOUSE, OWNER, { userId: OTHER }), /Injected failure/);
  assert.deepEqual(h.state(), before);
});

test('household creation rolls back if owner membership creation fails', async () => {
  const h = harness(); h.state().invitations = []; h.fail('members.create'); const before = clone(h.state());
  await assert.rejects(h.api.createHousehold(USER, { householdName: 'New household' }), /Injected failure/);
  assert.deepEqual(h.state(), before);
});

test('an owner can create an unpaid household but cannot invite or accept without paid access', async () => {
  const h = harness(); h.entitlement(false);
  await assert.rejects(h.api.addHouseholdMember(HOUSE, OWNER, { userId: OTHER }), /requires/);
  await assert.rejects(h.api.acceptHouseholdInvitation(USER, INVITE), /requires/);
  h.state().invitations = [];
  const household = await h.api.createHousehold(USER, { householdName: 'Unpaid household', planType: 'PREMIUM' });
  assert.equal(household.planType, 'FREE');
});

test('capacity follows the configured member limit rather than the old constant', async () => {
  const h = harness(); h.entitlement(true, 2);
  await assert.rejects(h.api.addHouseholdMember(HOUSE, OWNER, { userId: OTHER }), /limit reached/);
  await h.api.acceptHouseholdInvitation(USER, INVITE);
  assert.equal(h.state().members.length, 2);
});

test('after expiration owner can cancel invitations, remove members and delete household', async () => {
  const h = harness(); const member = await h.api.acceptHouseholdInvitation(USER, INVITE);
  await h.api.addHouseholdMember(HOUSE, OWNER, { userId: OTHER });
  const pending = h.state().invitations.find((row) => row.status === 'PENDING')!;
  h.entitlement(false);
  await assert.rejects(h.api.updateHouseholdMember(HOUSE, OWNER, member._id, { permission: {} }), /requires/);
  await h.api.cancelHouseholdInvitation(HOUSE, OWNER, pending._id);
  await h.api.removeHouseholdMember(HOUSE, OWNER, member._id);
  await h.api.deleteHousehold(HOUSE, OWNER);
  assert.equal(h.state().households[0].status, 'INACTIVE');
});

test('household deletion preserves original transfer-to-owner behavior atomically', async () => {
  const h = harness(); await h.api.acceptHouseholdInvitation(USER, INVITE);
  const before = clone(h.state()); h.fail('foods.updateMany');
  await assert.rejects(h.api.deleteHousehold(HOUSE, OWNER), /Injected failure/); assert.deepEqual(h.state(), before);
  h.fail(''); await h.api.deleteHousehold(HOUSE, OWNER);
  assert.equal(h.state().households[0].status, 'INACTIVE');
  assert.ok(h.state().members.every((row) => row.status === 'REMOVED'));
  assert.equal(h.state().foods[0].userId, OWNER); assert.equal(h.state().foods[0].ownerType, 'USER');
});

test('schemas declare partial unique constraints for active membership, owner and pending invitation', () => {
  const memberIndexes = HouseholdMember.schema.indexes();
  const invitationIndexes = HouseholdInvitation.schema.indexes();
  assert.ok(memberIndexes.some(([fields, options]: [Row, Row]) => fields.userId === 1 && options.unique && options.partialFilterExpression?.status === 'ACTIVE'));
  assert.ok(memberIndexes.some(([fields, options]: [Row, Row]) => fields.householdId === 1 && options.unique && options.partialFilterExpression?.role === 'OWNER'));
  assert.ok(invitationIndexes.some(([fields, options]: [Row, Row]) => fields.inviteEmail === 1 && options.unique && options.partialFilterExpression?.status === 'PENDING'));
});

test('controller preserves the response envelope for typed errors and index conflicts', async () => {
  const h = harness();
  const filename = path.resolve(__dirname, '../controllers/householdController.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  for (const [error, expectedStatus, expectedMessage] of [
    [new h.api.HouseholdMembershipError('Household invitation expired', 410), 410, /expired/],
    [new h.api.HouseholdMembershipError('Owner cannot be demoted', 403), 403, /demoted/],
    [{ code: 11000, keyPattern: { inviteEmail: 1 } }, 409, /pending family invitation/],
    [{ code: 11000, keyPattern: { userId: 1 } }, 409, /already a household member/],
    [{ code: 11000, keyPattern: { householdId: 1 } }, 409, /active owner/],
  ] as const) {
    const module = { exports: {} as any };
    vm.runInNewContext(compiled.outputText, { module, exports: module.exports, require: (name: string) => {
      assert.equal(name, '../services/householdService');
      return { ...h.api, acceptHouseholdInvitation: async () => { throw error; } };
    } }, { filename });
    let status = 0;
    let body: any;
    const response = { status(value: number) { status = value; return this; }, json(value: any) { body = value; return this; } };
    await module.exports.acceptHouseholdInvitationHandler({ user: { userId: USER }, params: { invitationId: INVITE } }, response);
    assert.equal(status, expectedStatus); assert.equal(body.success, false); assert.match(body.message, expectedMessage);
  }
});
