const protobuf = require('protobufjs');

const { PlantPhase } = require('../config/config');
const { getFriendBlacklist } = require('../models/store');
const { getUserState, sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { log, logWarn, randomDelay, toNum } = require('../utils/utils');
const {
  enterFriendFarm,
  extractReplyFriends,
  getAllFriends,
  handleFriendEnterError,
  leaveFriendFarm,
} = require('./friend-api');
const { getCurrentPhase } = require('./farm-land-analyzer');
const { getBag, getBagItems } = require('./warehouse');

const RAIN_POEM_FROG_BOTTLE_ITEM_ID = 5005;
const RAIN_POEM_CLOUD_BOTTLE_ITEM_ID = 5006;
const RAIN_POEM_PRANK_SOCIAL_TYPES = new Map([
  [RAIN_POEM_FROG_BOTTLE_ITEM_ID, 3],
  [RAIN_POEM_CLOUD_BOTTLE_ITEM_ID, 4],
]);
const RAIN_POEM_PRANK_ACTIVE_LIMIT_CODE = 1033011;
const RAIN_POEM_PRANK_LAND_OCCUPIED_CODE = 1001084;
const RAIN_POEM_PRANK_SOCIAL_ITEM_IDS = new Map([
  [RAIN_POEM_FROG_BOTTLE_ITEM_ID, 301102],
  [RAIN_POEM_CLOUD_BOTTLE_ITEM_ID, 301103],
]);

function isRainPoemPrankAlreadyActiveError(err) {
  return String(err?.message || '').includes(`code=${RAIN_POEM_PRANK_ACTIVE_LIMIT_CODE}`);
}

function isRainPoemPrankLandOccupiedError(err) {
  return String(err?.message || '').includes(`code=${RAIN_POEM_PRANK_LAND_OCCUPIED_CODE}`);
}

function getPrankBottleInventory(items) {
  const counts = new Map([
    [RAIN_POEM_FROG_BOTTLE_ITEM_ID, 0],
    [RAIN_POEM_CLOUD_BOTTLE_ITEM_ID, 0],
  ]);
  for (const item of Array.isArray(items) ? items : []) {
    const id = toNum(item?.id);
    if (counts.has(id)) counts.set(id, counts.get(id) + Math.max(0, toNum(item?.count)));
  }
  return {
    frog: counts.get(RAIN_POEM_FROG_BOTTLE_ITEM_ID),
    cloud: counts.get(RAIN_POEM_CLOUD_BOTTLE_ITEM_ID),
  };
}

function getPrankCandidateLandIds(lands, itemId) {
  const socialType = RAIN_POEM_PRANK_SOCIAL_TYPES.get(toNum(itemId));
  const socialItemId = RAIN_POEM_PRANK_SOCIAL_ITEM_IDS.get(toNum(itemId));
  if (!socialType) return [];
  const result = [];
  for (const land of Array.isArray(lands) ? lands : []) {
    const landId = toNum(land?.id);
    const plant = land?.plant;
    if (!landId || !plant || !Array.isArray(plant.phases) || plant.phases.length === 0) continue;
    const phase = getCurrentPhase(plant.phases, false, '', plant.id)?.phase;
    if (!phase || phase === PlantPhase.MATURE || phase === PlantPhase.DEAD) continue;
    const alreadyApplied = (plant.social_items || []).some(item => (
      toNum(item?.item_id) === toNum(itemId)
      || toNum(item?.item_id) === toNum(socialItemId)
      || toNum(item?.type) === socialType
    ));
    if (!alreadyApplied) result.push(landId);
  }
  return result;
}

function encodeRainPoemPrankRequest(gid, landId, itemId, itemUid) {
  if (!RAIN_POEM_PRANK_SOCIAL_TYPES.has(toNum(itemId))) throw new Error(`不支持的使坏瓶: ${itemId}`);
  if (toNum(itemUid) <= 0) throw new Error(`使坏瓶缺少背包 UID: ${itemId}`);
  const writer = protobuf.Writer.create();
  writer.uint32(10).fork()
    .uint32(8).int64(toNum(itemId))
    .uint32(16).int64(1)
    .uint32(48).int64(toNum(itemUid))
    .ldelim();
  writer.uint32(18).fork()
    .uint32(8).int64(toNum(gid))
    .uint32(18).fork().int64(toNum(landId)).ldelim()
    .ldelim();
  return writer.finish();
}

async function putRainPoemPrankBottle(gid, landId, itemId, itemUid) {
  const payload = encodeRainPoemPrankRequest(gid, landId, itemId, itemUid);
  const { body } = await sendMsgAsync('gamepb.itempb.ItemService', 'Use', payload);
  return types.UseReply.decode(body);
}

async function runRainPoemPrankPlacement() {
  const userState = getUserState();
  const myGid = toNum(userState?.gid);
  if (!myGid) throw new Error('尚未获取当前账号 GID');

  const bagItems = getBagItems(await getBag());
  const inventory = getPrankBottleInventory(bagItems);
  const queue = [
    ...bagItems.flatMap(item => (
      RAIN_POEM_PRANK_SOCIAL_TYPES.has(toNum(item?.id)) && toNum(item?.uid) > 0
        ? Array(Math.max(0, toNum(item?.count))).fill(null).map(() => ({ itemId: toNum(item.id), itemUid: toNum(item.uid) }))
        : []
    )),
  ];
  if (queue.length === 0) return { placed: 0, frog: 0, cloud: 0, inventory };

  const accountId = process.env.FARM_ACCOUNT_ID || userState.accountId || '';
  const blacklist = new Set(getFriendBlacklist(accountId).map(toNum));
  const friends = extractReplyFriends(await getAllFriends())
    .map(friend => ({
      gid: toNum(friend?.gid),
      name: String(friend?.remark || friend?.name || ''),
      level: toNum(friend?.level),
    }))
    .filter(friend => friend.gid > 0 && friend.gid !== myGid && !blacklist.has(friend.gid))
    .sort((a, b) => b.level - a.level);

  const placed = { frog: 0, cloud: 0 };
  let consecutiveFailures = 0;
  let activeFriends = 0;
  for (const friend of friends) {
    if (queue.length === 0 || consecutiveFailures >= 3) break;
    let entered = false;
    try {
      const visit = await enterFriendFarm(friend.gid);
      entered = true;
      for (let index = 0; index < queue.length;) {
        const { itemId, itemUid } = queue[index];
        const candidateLandIds = getPrankCandidateLandIds(visit?.lands, itemId);
        if (candidateLandIds.length === 0) {
          index++;
          continue;
        }
        let placed = false;
        let friendExhausted = false;
        for (const landId of candidateLandIds) {
          try {
            await putRainPoemPrankBottle(friend.gid, landId, itemId, itemUid);
            queue.splice(index, 1);
            if (itemId === RAIN_POEM_FROG_BOTTLE_ITEM_ID) placed.frog++;
            else placed.cloud++;
            consecutiveFailures = 0;
            placed = true;
            break;
          } catch (err) {
            if (isRainPoemPrankLandOccupiedError(err)) {
              continue;
            }
            if (isRainPoemPrankAlreadyActiveError(err)) {
              activeFriends++;
              friendExhausted = true;
              break;
            }
            consecutiveFailures++;
            logWarn('活动', `给 ${friend.name || `GID:${friend.gid}`} 使用使坏瓶失败: ${err.message}`, {
              module: 'activity', event: '雨落成诗自动使坏', result: 'error',
              friendGid: friend.gid, landId, itemId,
            });
            friendExhausted = true;
            break;
          }
        }
        if (placed || friendExhausted) break;
        index++;
      }
    } catch (err) {
      handleFriendEnterError(friend.gid, friend.name || `GID:${friend.gid}`, err);
    } finally {
      if (entered) {
        try { await leaveFriendFarm(friend.gid); } catch { }
      }
    }
    if (queue.length > 0) await randomDelay(500, 1500);
  }

  const total = placed.frog + placed.cloud;
  if (total > 0) {
    log('活动', `自动使用使坏瓶完成：青蛙 ${placed.frog} 个，乌云 ${placed.cloud} 个`, {
      module: 'activity', event: '雨落成诗自动使坏', result: 'ok', count: total,
    });
  }
  return { placed: total, ...placed, inventory, remaining: queue.length, activeFriends };
}

module.exports = {
  RAIN_POEM_FROG_BOTTLE_ITEM_ID,
  RAIN_POEM_CLOUD_BOTTLE_ITEM_ID,
  RAIN_POEM_PRANK_SOCIAL_TYPES,
  RAIN_POEM_PRANK_SOCIAL_ITEM_IDS,
  RAIN_POEM_PRANK_ACTIVE_LIMIT_CODE,
  RAIN_POEM_PRANK_LAND_OCCUPIED_CODE,
  getPrankBottleInventory,
  getPrankCandidateLandIds,
  isRainPoemPrankAlreadyActiveError,
  isRainPoemPrankLandOccupiedError,
  encodeRainPoemPrankRequest,
  putRainPoemPrankBottle,
  runRainPoemPrankPlacement,
};
