import fs from 'fs';
import path from 'path';

const EMPTY_STATE = Object.freeze({
  version: 1,
  enabled: true,
  current: null,
  queue: [],
  history: [],
});

export class JsonSongRepository {
  constructor(filePath) {
    this.filePath = filePath;
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return {
        ...EMPTY_STATE,
        ...parsed,
        queue: Array.isArray(parsed.queue) ? parsed.queue : [],
        history: Array.isArray(parsed.history) ? parsed.history : [],
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[SongRepository] 状态读取失败，将使用空状态:', error.message);
      }
      return structuredClone(EMPTY_STATE);
    }
  }

  save(state) {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.filePath);
  }
}

export class MemorySongRepository {
  constructor(initialState = EMPTY_STATE) {
    this.state = structuredClone(initialState);
  }

  load() {
    return structuredClone(this.state);
  }

  save(state) {
    this.state = structuredClone(state);
  }
}
