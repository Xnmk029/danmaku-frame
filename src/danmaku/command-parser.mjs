const REQUEST_PATTERNS = [
  /^(?:点歌|點歌|来一首|來一首)\s*[:：]?\s*(.+)$/i,
  /^(?:song|request)\s+(.+)$/i,
];

const EXACT_COMMANDS = new Map([
  ['取消点歌', 'cancel-own'],
  ['取消點歌', 'cancel-own'],
  ['我的点歌', 'list-own'],
  ['我的點歌', 'list-own'],
  ['歌单', 'list'],
  ['歌單', 'list'],
  ['点歌帮助', 'help'],
  ['點歌幫助', 'help'],
  ['下一首', 'skip'],
  ['下一曲', 'skip'],
  ['切歌', 'skip'],
  ['暂停点歌', 'pause'],
  ['暫停點歌', 'pause'],
  ['继续播放', 'resume'],
  ['繼續播放', 'resume'],
  ['清空歌单', 'clear'],
  ['清空歌單', 'clear'],
  ['开启点歌', 'enable'],
  ['開啟點歌', 'enable'],
  ['关闭点歌', 'disable'],
  ['關閉點歌', 'disable'],
]);

export function parseSongCommand(text) {
  const normalized = String(text || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return null;

  const exact = EXACT_COMMANDS.get(normalized);
  if (exact) return { type: exact };

  for (const pattern of REQUEST_PATTERNS) {
    const match = normalized.match(pattern);
    if (match?.[1]?.trim()) {
      return { type: 'request', query: match[1].trim().slice(0, 200) };
    }
  }

  return null;
}
