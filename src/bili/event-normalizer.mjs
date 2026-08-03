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
