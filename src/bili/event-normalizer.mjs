function unwrapMsgExtra(raw) {
  // 新版协议：info[0][15] = { extra: "<msgExtra JSON>" }（包装层）
  // 旧版协议：info[0][15] 直接是 msgExtra（对象或 JSON 字符串）
  if (raw === null || raw === undefined) return null;
  try {
    const outer = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (outer && typeof outer.extra === 'string') return JSON.parse(outer.extra);
    if (outer && typeof outer.extra === 'object' && outer.extra !== null) return outer.extra;
    return outer;
  } catch {
    return null;
  }
}

function inferEmoteSize(width, height) {
  const d = Math.max(Number(width) || 0, Number(height) || 0);
  if (d >= 60) return 'L';
  if (d >= 32) return 'M';
  return 'S';
}

function parseDanmakuEmots(info0) {
  // msgExtra.emots: { "[表情名]": { emoji, url, width, height, emoticon_unique, ... } }
  const msgExtra = unwrapMsgExtra(Array.isArray(info0) ? info0[15] : null);
  const emots = [];
  if (msgExtra?.emots && typeof msgExtra.emots === 'object') {
    for (const [key, entry] of Object.entries(msgExtra.emots)) {
      if (entry && typeof entry === 'object' && entry.url) {
        emots.push({
          key: String(key || ''),
          // 统一 https，避免 HTTPS 页面 mixed-content 拦截
          url: String(entry.url).replace(/^http:\/\//i, 'https://'),
          size: inferEmoteSize(entry.width, entry.height),
          bulge: Number(msgExtra.bulge_display || 0) === 1,
        });
      }
    }
  }
  return emots;
}

function parseBigEmote(info0) {
  // 旧协议：info[0][13] 是整条大表情对象；新协议该位置为 "{}"（忽略）
  const entry = Array.isArray(info0) ? info0[13] : null;
  if (!entry || typeof entry !== 'object' || !entry.url) return null;
  return {
    unique: String(entry.emoticon_unique || ''),
    url: String(entry.url).replace(/^http:\/\//i, 'https://'),
    width: Number(entry.width || 0),
    height: Number(entry.height || 0),
  };
}

export function cleanDanmakuUser(rawUser, uid, medal) {
  if (!rawUser) return '匿名用户';
  if (/^某\*+$/.test(rawUser) || (rawUser.startsWith('某') && rawUser.includes('*'))) {
    if (medal?.name) return `${medal.name}·粉丝`;
    if (uid) return `用户_${String(uid).slice(-4)}`;
    return '弹幕观众';
  }
  return rawUser;
}

export function normalizeBiliCommand(payload) {
  if (!payload?.cmd) return null;

  if (payload.cmd.includes('DANMU_MSG')) {
    const info = payload.info || [];
    const uid = (info[2] && info[2][0]) || 0;
    const medal = (info[3] && info[3][1])
      ? { name: info[3][1], lv: info[3][0] }
      : null;
    const rawUser = (info[2] && info[2][1]) || '匿名用户';
    return {
      type: 'danmaku',
      uid: String(uid || ''),
      user: cleanDanmakuUser(rawUser, uid, medal),
      rawUser, // 原始用户名（未脱敏，用于用户级音色预设匹配）
      text: String(info[1] || ''),
      emots: parseDanmakuEmots(info[0]),
      bigEmote: parseBigEmote(info[0]),
      guard: Number(info[7] || 0),
      medal,
      admin: Boolean(info[2]?.[2]),
      receivedAt: Date.now(),
    };
  }

  if (payload.cmd === 'SEND_GIFT') {
    const data = payload.data || {};
    const medalInfo = data.medal_info || {};
    const medal = medalInfo.medal_name
      ? { name: medalInfo.medal_name, lv: medalInfo.medal_level || 0 }
      : null;
    return {
      type: 'gift',
      uid: String(data.uid || ''),
      user: data.uname || '匿名用户',
      text: `赠送了 ${data.giftName || '礼物'} x${data.num || 1}`,
      giftName: data.giftName || '礼物',
      giftCount: Number(data.num || 1),
      price: Number(data.price || 0), // 金瓜子（1000 = 1 元）
      medal,
      guard: Number(medalInfo.guard_level || data.guard_level || 0),
      receivedAt: Date.now(),
    };
  }

  if (payload.cmd === 'SUPER_CHAT_MESSAGE') {
    const data = payload.data || {};
    const medalInfo = data.medal_info || {};
    const medal = medalInfo.medal_name
      ? { name: medalInfo.medal_name, lv: medalInfo.medal_level || 0 }
      : null;
    return {
      type: 'sc',
      uid: String(data.uid || ''),
      user: data.user_info?.uname || '匿名用户',
      text: `[SC ¥${data.price || 0}] ${data.message || ''}`,
      message: String(data.message || ''),
      price: Number(data.price || 0), // 元
      medal,
      guard: Number(medalInfo.guard_level || 0),
      receivedAt: Date.now(),
    };
  }

  // 上舰（舰长/提督/总督开通或续费）
  if (payload.cmd === 'GUARD_BUY') {
    const data = payload.data || {};
    const level = Number(data.guard_level || 0);
    const guardName = { 1: '总督', 2: '提督', 3: '舰长' }[level] || data.gift_name || '大航海';
    const count = Number(data.num || data.gift_num || 1);
    return {
      type: 'guard',
      uid: String(data.uid || ''),
      user: data.username || data.uname || '匿名用户',
      text: `开通了${guardName}${count > 1 ? ` x${count}` : ''}`,
      guardLevel: level,
      guardName,
      count,
      price: Number(data.price || 0), // 金瓜子
      receivedAt: Date.now(),
    };
  }

  // 进场/互动（进入直播间、关注、分享、点赞主播）
  // 注：INTERACT_WORD_V2 走 protobuf（data.pb），JSON 无法解析，忽略。
  if (payload.cmd === 'INTERACT_WORD') {
    const data = payload.data || {};
    const msgTypeLabels = {
      1: '进入直播间', 2: '关注了主播', 3: '分享了直播间',
      4: '特别关注了主播', 5: '互相关注', 6: '为主播点赞',
    };
    const fm = data.fans_medal || null;
    const medal = fm?.medal_name
      ? { name: fm.medal_name, lv: fm.medal_level || 0 }
      : null;
    return {
      type: 'entry',
      uid: String(data.uid || ''),
      user: data.uname || '访客',
      text: msgTypeLabels[Number(data.msg_type)] || '进入直播间',
      msgType: Number(data.msg_type || 1),
      medal,
      guard: Number(fm?.guard_level || 0),
      receivedAt: Date.now(),
    };
  }

  // 数据栏：看过人数 / 点赞数
  if (payload.cmd === 'WATCHED_CHANGE') {
    const data = payload.data || {};
    return {
      type: 'watched',
      count: Number(data.num || 0),
      text: String(data.text_large || data.text_small || ''),
      receivedAt: Date.now(),
    };
  }

  if (payload.cmd === 'LIKE_INFO_V3_UPDATE') {
    const data = payload.data || {};
    return {
      type: 'like',
      count: Number(data.like_count || data.click_count || 0),
      receivedAt: Date.now(),
    };
  }

  return null;
}
