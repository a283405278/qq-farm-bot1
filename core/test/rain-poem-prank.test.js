const assert = require('node:assert/strict');
const test = require('node:test');

const { loadProto } = require('../src/utils/proto');
const {
  encodeRainPoemPrankRequest,
  getPrankBottleInventory,
  getPrankCandidateLandIds,
  isRainPoemPrankAlreadyActiveError,
  isRainPoemPrankLandOccupiedError,
} = require('../src/services/rain-poem-prank-service');

test.before(async () => {
  await loadProto();
});

test('prank bottle inventory keeps frog and cloud bottles separate', () => {
  assert.deepEqual(getPrankBottleInventory([
    { id: 5005, count: 2 },
    { id: 5006, count: 3 },
    { id: 5002, count: 9 },
  ]), { frog: 2, cloud: 3 });
});

test('frog bottle request carries the target land id in the official ItemService.Use shape', () => {
  const frog = encodeRainPoemPrankRequest(1000036036, 1001, 5005, 10586);

  assert.equal(Buffer.from(frog).toString('hex'), '0a08088d27100130da52120a08c4adeddc031202e907');
});

test('unknown items cannot be sent through the prank placement helper', () => {
  assert.throws(() => encodeRainPoemPrankRequest(1, 1001, 5002, 1), /不支持的使坏瓶/);
  assert.throws(() => encodeRainPoemPrankRequest(1, 1001, 5005, 0), /缺少背包 UID/);
});

test('an existing prank event limit is recognized as an active effect', () => {
  assert.equal(isRainPoemPrankAlreadyActiveError(new Error(
    'gamepb.itempb.ItemService.Use 错误: code=1033011 该使坏事件同时存在数量已达上限'
  )), true);
  assert.equal(isRainPoemPrankAlreadyActiveError(new Error('code=1000021 配置不存在')), false);
});

test('an occupied land is recognized as already carrying a prank effect', () => {
  assert.equal(isRainPoemPrankLandOccupiedError(new Error(
    'gamepb.itempb.ItemService.Use 错误: code=1001084 作物上已有使坏事件，不可使用'
  )), true);
  assert.equal(isRainPoemPrankLandOccupiedError(new Error('code=1033011 数量已达上限')), false);
});

test('lands already carrying the social item id or type are excluded before placing', () => {
  const lands = [
    { id: 1, plant: { id: 10, phases: [{ phase: 2, remaining: 100 }], social_items: [{ item_id: 5005, type: 3 }] } },
    { id: 2, plant: { id: 20, phases: [{ phase: 2, remaining: 100 }], social_items: [{ item_id: 301102, type: 3 }] } },
    { id: 3, plant: { id: 30, phases: [{ phase: 2, remaining: 100 }], social_items: [] } },
    { id: 4, plant: { id: 40, phases: [{ phase: 2, remaining: 100 }], social_items: [{ item_id: 9999, type: 7 }] } },
  ];

  const candidates = getPrankCandidateLandIds(lands, 5005);

  assert.deepEqual(candidates, [3, 4]);
});
