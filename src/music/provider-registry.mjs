export class MusicProviderRegistry {
  constructor(providers = []) {
    this.providers = [...providers];
  }

  register(provider) {
    this.providers.push(provider);
  }

  async resolve(query) {
    const failures = [];
    for (const provider of this.providers) {
      try {
        const result = await provider.resolve(query);
        if (result) return result;
      } catch (error) {
        failures.push(error.message);
      }
    }

    if (failures.length) throw new Error(failures.join('；'));
    throw new Error('未找到匹配歌曲。请检查本地 music 目录或使用允许的音频直链');
  }
}
