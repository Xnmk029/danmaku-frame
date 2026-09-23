/**
 * 音色设计注册指令解析（观众级弹幕命令，命中后由 TTS 服务消费、不朗读）。
 *
 * 指令集：
 *   设计音色 <提示词>   → { type:'register', prompt }   （别名：定制音色/设定音色/音色设计）
 *   删除音色 / 重置音色 → { type:'remove' }             （删自己）
 *   删除音色 <uid>      → { type:'remove', targetUid }  （主播/房管删他人）
 *   我的音色 / 查询音色 → { type:'query' }
 */
const REGISTER_PATTERN =
  /^(?:注册聲音|设计音色|設計音色|定制音色|訂製音色|设定音色|設定音色|音色设计|音色設計)\s*[:：]?\s*(.+)$/;

const REMOVE_TARGET_PATTERN =
  /^(?:删除音色|刪除音色|删除声音|刪除聲音|重置音色)\s*[:：]?\s*(\d{1,20})$/;

const EXACT_COMMANDS = new Map([
  ['删除音色', 'remove'],
  ['刪除音色', 'remove'],
  ['删除声音', 'remove'],
  ['刪除聲音', 'remove'],
  ['重置音色', 'remove'],
  ['我的音色', 'query'],
  ['我的聲音', 'query'],
  ['查询音色', 'query'],
  ['查詢音色', 'query'],
]);

export function parseVoiceCommand(text) {
  const normalized = String(text || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return null;

  const exact = EXACT_COMMANDS.get(normalized);
  if (exact) return { type: exact };

  const removeTarget = normalized.match(REMOVE_TARGET_PATTERN);
  if (removeTarget) return { type: 'remove', targetUid: removeTarget[1] };

  const selection = normalized.match(/^选择音色\s*[:：]?\s*([一二三123])$/);
  if (selection) return { type: 'fish-select', index: ({ 一: 1, 二: 2, 三: 3 })[selection[1]] || Number(selection[1]) };
  const search = normalized.match(/^搜索音色(?:\s+|[:：]\s*)(.+)$/);
  if (search) return { type: 'fish-search', query: search[1].trim() };
  const fish = normalized.match(/^(?:注册音色|音色注册|选择音色|音色)(?:\s+|[:：]\s*)(.+)$/);
  if (fish) return { type: 'fish-bind', voice: fish[1].trim() };

  const register = normalized.match(REGISTER_PATTERN);
  if (register?.[1]?.trim()) return { type: 'register', prompt: register[1].trim() };

  return null;
}
