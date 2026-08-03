const elements = {
  player: document.getElementById('player'),
  audio: document.getElementById('audio'),
  cover: document.getElementById('cover'),
  coverFallback: document.getElementById('coverFallback'),
  title: document.getElementById('title'),
  artist: document.getElementById('artist'),
  requester: document.getElementById('requester'),
  status: document.getElementById('status'),
  progress: document.getElementById('progressBar'),
  elapsed: document.getElementById('elapsed'),
  duration: document.getElementById('duration'),
  nextSong: document.getElementById('nextSong'),
  queueCount: document.getElementById('queueCount'),
};

const params = new URLSearchParams(location.search);
const token = params.get('token') || '';
const wsPort = params.get('wsPort') || '7789';
const wsHost = location.hostname || '127.0.0.1';
let socket;
let reconnectTimer;
let currentId = '';

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ ...payload, ...(token ? { token } : {}) }));
  }
}

function renderState(state) {
  const current = state.current;
  const queue = state.queue || [];
  elements.queueCount.textContent = String(queue.length);
  elements.nextSong.textContent = queue[0]
    ? `${queue[0].title}${queue[0].artist ? ` / ${queue[0].artist}` : ''}`
    : 'QUEUE EMPTY';

  if (!current) {
    currentId = '';
    elements.audio.removeAttribute('src');
    elements.player.dataset.state = 'idle';
    elements.status.textContent = state.enabled ? 'STANDBY' : 'DISABLED';
    elements.title.textContent = '等待点歌';
    elements.artist.textContent = state.enabled ? '发送“点歌 歌名”加入队列' : '点歌功能当前已关闭';
    elements.requester.textContent = 'REQUESTED BY —';
    elements.progress.style.width = '0';
    elements.elapsed.textContent = '00:00';
    elements.duration.textContent = '00:00';
    elements.cover.hidden = true;
    elements.coverFallback.hidden = false;
    return;
  }

  elements.player.dataset.state = 'playing';
  elements.status.textContent = 'NOW PLAYING';
  elements.title.textContent = current.title || '未知歌曲';
  elements.artist.textContent = current.artist || current.provider || 'UNKNOWN SOURCE';
  elements.requester.textContent = `REQUESTED BY ${current.requestedBy?.name || '匿名用户'}`;
  if (current.coverUrl) {
    elements.cover.src = current.coverUrl;
    elements.cover.hidden = false;
    elements.coverFallback.hidden = true;
  } else {
    elements.cover.hidden = true;
    elements.coverFallback.hidden = false;
  }

  if (current.id !== currentId) {
    currentId = current.id;
    elements.audio.src = current.sourceUrl;
    elements.audio.play().catch(() => {
      elements.status.textContent = 'CLICK TO PLAY';
    });
  }
}

function connect() {
  clearTimeout(reconnectTimer);
  socket = new WebSocket(`ws://${wsHost}:${wsPort}`);
  socket.addEventListener('open', () => send({ action: 'song.get_state' }));
  socket.addEventListener('message', event => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'song.state') renderState(payload);
      else if (payload.type === 'song.player_command') {
        if (payload.action === 'pause') elements.audio.pause();
        else if (payload.action === 'resume') elements.audio.play().catch(() => {});
      }
    } catch {
      // Ignore malformed server messages.
    }
  });
  socket.addEventListener('close', () => {
    elements.status.textContent = 'RECONNECTING';
    reconnectTimer = setTimeout(connect, 3000);
  });
  socket.addEventListener('error', () => socket.close());
}

elements.audio.addEventListener('timeupdate', () => {
  const duration = elements.audio.duration;
  elements.elapsed.textContent = formatTime(elements.audio.currentTime);
  elements.duration.textContent = formatTime(duration);
  elements.progress.style.width = duration
    ? `${Math.min(100, elements.audio.currentTime / duration * 100)}%`
    : '0';
});
elements.audio.addEventListener('ended', () => send({ action: 'song.player_event', event: 'ended' }));
elements.audio.addEventListener('error', () => {
  if (currentId) send({ action: 'song.player_event', event: 'error' });
});
document.addEventListener('click', () => {
  if (elements.audio.src && elements.audio.paused) elements.audio.play().catch(() => {});
});

connect();
