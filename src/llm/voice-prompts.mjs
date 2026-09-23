/**
 * 音色设计提示词细化：把观众的抽象/简短描述，扩写成 MiMo VoiceDesign 模型
 * 可直接消费的多维度音色描述（年龄/性别/音色质感/口音/语速/气质/录音质感）。
 */

const VOICE_DESIGN_SYSTEM = `你是直播弹幕朗读的音色设计师。把观众的一句话需求，改写成小米 MiMo VoiceDesign 语音合成模型可直接消费的音色描述。

规则：
- 只输出音色描述本身：不要引号、不要解释、不要前后缀
- 用中文，一段连贯描述，40-110 字
- 按需覆盖维度：年龄段、性别、音色质感（清亮/沙哑/软糯/磁性等）、口音或方言、语速节奏、情绪气质、录音质感
- 用户点名某个角色/人物/IP 时：转换成该角色声音特征的客观描述，不要在输出里写角色名
- 用户输入空泛（如"萝莉""好听的声音"）时：补充合理的具体细节，保留用户核心意图
- 用户输入不像音色需求（聊天/跑题）时：按最接近的音色意图理解并描述
- 不输出露骨、违规内容；遇到此类需求输出"温和的青年中性嗓音，吐字清晰，语气自然"`;

/**
 * @param {import('./sensenova.mjs').SenseNovaClient} llm
 * @param {string} rawPrompt 观众原始描述
 * @returns {Promise<string>} 细化后的音色描述（已清洗为单行）
 */
export async function refineVoicePrompt(llm, rawPrompt) {
  const refined = await llm.chat(
    [
      { role: 'system', content: VOICE_DESIGN_SYSTEM },
      { role: 'user', content: String(rawPrompt) },
    ],
    { maxTokens: 300, temperature: 0.7 },
  );
  // 防御性清洗：去首尾引号/括号包裹、折叠空白为单行
  return String(refined)
    .replace(/\s+/g, ' ')
    .replace(/^[「『"'"'""''（(【\[]+|[」』"'"'""''）)】\]]+$/g, '')
    .trim();
}
