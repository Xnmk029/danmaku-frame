import fs from 'fs';
import path from 'path';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac']);

function normalizeSearch(value) {
  return String(value || '')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s._-]+/g, '');
}

function metadataFromFilename(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  const [artist, ...titleParts] = base.split(/\s+-\s+/);
  return titleParts.length
    ? { artist: artist.trim(), title: titleParts.join(' - ').trim() }
    : { artist: '', title: base };
}

export class LocalMusicProvider {
  constructor({ projectRoot, musicDirectory }) {
    this.projectRoot = path.resolve(projectRoot);
    this.musicDirectory = path.resolve(musicDirectory);
  }

  listFiles() {
    if (!fs.existsSync(this.musicDirectory)) return [];
    return fs.readdirSync(this.musicDirectory, { withFileTypes: true })
      .filter(entry => entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .map(entry => path.join(this.musicDirectory, entry.name));
  }

  async resolve(query) {
    const needle = normalizeSearch(query);
    if (!needle || /^https?:\/\//i.test(query)) return null;

    const candidates = this.listFiles()
      .map(filePath => ({
        filePath,
        score: normalizeSearch(path.basename(filePath)).includes(needle) ? 1 : 0,
      }))
      .filter(candidate => candidate.score > 0);

    if (!candidates.length) return null;
    const selected = candidates[0].filePath;
    const relative = path.relative(this.projectRoot, selected);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('本地音乐目录必须位于 danmaku-frame 目录内，才能由浏览器安全播放');
    }

    return {
      provider: 'local',
      sourceUrl: `/${relative.split(path.sep).map(encodeURIComponent).join('/')}`,
      durationSeconds: 0,
      coverUrl: '',
      ...metadataFromFilename(selected),
    };
  }
}
