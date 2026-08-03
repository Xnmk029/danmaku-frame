const AUDIO_PATH_PATTERN = /\.(?:mp3|wav|ogg|m4a|flac)(?:$|[?#])/i;

export class DirectUrlProvider {
  constructor({ enabled = false } = {}) {
    this.enabled = enabled;
  }

  async resolve(query) {
    if (!this.enabled || !/^https?:\/\//i.test(query)) return null;
    const url = new URL(query);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (!AUDIO_PATH_PATTERN.test(url.href)) {
      throw new Error('直链必须指向受支持的音频文件');
    }

    return {
      provider: 'direct-url',
      title: decodeURIComponent(url.pathname.split('/').pop() || '网络音频'),
      artist: '',
      sourceUrl: url.href,
      durationSeconds: 0,
      coverUrl: '',
    };
  }
}
