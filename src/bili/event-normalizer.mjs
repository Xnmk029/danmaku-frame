function parseDanmakuEmots(info0) {
  // info[0][15]: msgExtra（JSON 字符串或对象），emots: { "[表情名]": { url, meta: { size } } }
  const raw = Array.isArray(info0) ? info0[15] : null;
  let extra = null;
  if (typeof raw === 'string') {
    try { extra = JSON.parse(raw); } catch { /* 非 JSON 忽略 */ }
  } else if (raw && typeof raw === 'object') {
    extra = raw;
  }
  const emots = [];
  if (extra?.emots && typeof extra.emots === 'object') {
    for (const [key, entry] of Object.entries(extra.emots)) {
      if (entry && typeof entry === 'object' && entry.url) {
        emots.push({
          key: String(key || ''),
          url: String(entry.url),
          size: String(entry.meta?.size || 'S').toUpperCase(),
        });
      }
    }
  }
  return emots;
}

function parseBigEmote(info0) {
  // info[0][13]: 整条弹幕即单个大表情
  const entry = Array.isArray(info0) ? info0[13] : null;
  if (!entry || typeof entry !== 'object' || !entry.url) return null;
  return {
    unique: String(entry.emoticon_unique || ''),
    url: String(entry.url),
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
    return {
      type: 'gift',
      uid: String(data.uid || ''),
      user: data.uname || '匿名用户',
      text: `赠送了 ${data.giftName || '礼物'} x${data.num || 1}`,
      giftName: data.giftName || '礼物',
      giftCount: Number(data.num || 1),
      price: Number(data.price || 0),
      receivedAt: Date.now(),
    };
  }

  if (payload.cmd === 'SUPER_CHAT_MESSAGE') {
    const data = payload.data || {};
    return {
      type: 'sc',
      uid: String(data.uid || ''),
      user: data.user_info?.uname || '匿名用户',
      text: `[SC ¥${data.price || 0}] ${data.message || ''}`,
      message: String(data.message || ''),
      price: Number(data.price || 0),
      receivedAt: Date.now(),
    };
  }

  return null;
}
