// discord-player emits skip/error synchronously before dispatching the next
// track. Park the queue at that boundary; pause()/stop() cannot protect it:
// pause does not stop extraction and stop clears the accepted playlist.
const recoveries = new WeakMap();
const STABLE_PLAYBACK_MS = 8_000;

function stateFor(queue) {
  let state = recoveries.get(queue);
  if (!state) {
    state = { failed: [], observed: new Set(), blocked: false, held: [], message: null, started: null };
    recoveries.set(queue, state);
  }
  return state;
}

function trackKey(track) {
  return track?.id || track?.url || track;
}

function playedMilliseconds(queue, track) {
  const resource = queue?.dispatcher?.audioResource;
  if (!resource || trackKey(resource.metadata) !== trackKey(track)) return 0;
  return Number(resource.playbackDuration || 0);
}

function failureMessage(error) {
  const text = String(error?.message || error || '');
  if (/DAVE|MLS|voice|phòng thoại|mã hoá/i.test(text)) {
    return { systemic: true, message: 'Kết nối âm thanh Discord chưa sẵn sàng. Hãy kiểm tra quyền Kết nối/Nói và thử lại.' };
  }
  if (/403|429|sign in|confirm.*bot|captcha|too many requests/i.test(text)) {
    return { systemic: true, message: 'YouTube đang từ chối nguồn âm thanh trên hosting. Cần kiểm tra kết nối nguồn phát trước khi thử lại.' };
  }
  return { systemic: false, message: 'Không nhận được âm thanh ổn định từ YouTube. Hàng đợi đã được giữ lại; nhấn Thử phát lại sau khi kiểm tra nguồn phát.' };
}

export function noteMusicPlaybackStart(queue, track) {
  const state = stateFor(queue);
  state.started = trackKey(track);
  // A Playing event can be followed by Idle at 0s. Do not reset failures here.
}

export function ignoreMusicPlaybackFinish(queue) {
  stateFor(queue).started = null;
}

export function noteMusicPlaybackFailure(queue, track, error) {
  const state = stateFor(queue);
  if (state.blocked || !track) return state.blocked;
  const key = trackKey(track);
  if (error?.code === 'ERR_STREAM_PREMATURE_CLOSE' && state.started !== key) return false;
  // One extraction failure emits BOTH PlayerSkip and PlayerError.
  if (state.observed.has(key)) return false;
  if (playedMilliseconds(queue, track) >= STABLE_PLAYBACK_MS) {
    state.failed = [];
    state.observed.clear();
  }
  state.observed.add(key);
  state.failed.push(track);
  const failure = failureMessage(error);
  state.message = failure.message;
  if (!failure.systemic && state.failed.length < 2) return false;
  if (!queue.tracks?.toArray || !queue.tracks?.clear) return false;

  state.blocked = true;
  state.held = [...state.failed, ...queue.tracks.toArray()];
  state.repeatMode = queue.repeatMode;
  state.leaveOnEnd = queue.options?.leaveOnEnd;
  state.channel = queue.channel;
  queue.tracks.clear();
  // Prevent repeat/autoplay paths from bypassing the empty dispatch queue.
  queue.setRepeatMode?.(0);
  if (queue.options) queue.options.leaveOnEnd = false;
  return true;
}

export function noteMusicPlaybackFinish(queue, track) {
  const state = stateFor(queue);
  if (state.blocked || state.observed.has(trackKey(track))) return;
  const played = playedMilliseconds(queue, track);
  if (played >= STABLE_PLAYBACK_MS) {
    state.failed = [];
    state.observed.clear();
    state.message = null;
  } else if (state.started === trackKey(track)
    && Number(track?.durationMS || 0) > STABLE_PLAYBACK_MS
    && queue?.dispatcher?.audioResource) {
    // A decoder that ends cleanly at 0s is still a failed music start.
    noteMusicPlaybackFailure(queue, track, 'YouTube audio ended before stable playback');
    return true;
  }
  return false;
}

export function getMusicRecovery(queue) {
  const state = queue && recoveries.get(queue);
  return {
    blocked: Boolean(state?.blocked),
    consecutiveFailures: state?.failed.length || 0,
    message: state?.message || null,
    tracks: state?.blocked ? [...state.held] : [],
  };
}

export function removeHeldMusicTrack(queue, index) {
  const state = recoveries.get(queue);
  if (!state?.blocked || index < 0 || index >= state.held.length) return false;
  state.held.splice(index, 1);
  return true;
}

export function getMusicRecoveryChannel(queue) {
  return recoveries.get(queue)?.channel || queue.channel;
}

export function restoreMusicQueue(queue) {
  const state = recoveries.get(queue);
  if (!state?.blocked) return false;
  if (!state.held.length) throw new Error('Hàng đợi đang trống. Hãy dừng phiên rồi thêm bài mới.');
  // These tracks were already accepted. Do not re-fetch metadata or duplicate
  // the playlist; the current maxSize may have changed since acceptance.
  queue.tracks.add([...state.held]);
  queue.setRepeatMode?.(state.repeatMode ?? 0);
  if (queue.options) queue.options.leaveOnEnd = state.leaveOnEnd;
  recoveries.delete(queue);
  return true;
}

export function clearMusicRecovery(queue) {
  const state = recoveries.get(queue);
  if (state?.blocked && queue.options) queue.options.leaveOnEnd = state.leaveOnEnd;
  recoveries.delete(queue);
}
