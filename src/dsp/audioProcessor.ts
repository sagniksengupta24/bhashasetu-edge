// src/dsp/audioProcessor.ts
// 100Hz-3400Hz Web Audio API bandpass DSP, live SNR dB metering,
// 16kHz mono PCM downsampling, and 60s max recording cap to prevent OOM on low-RAM Androids.

export const MAX_RECORDING_MS = 60_000;

export function downsampleTo16kHz(
  chunks: Float32Array[],
  inputSampleRate: number
): Float32Array {
  let totalLength = 0;
  for (const c of chunks) totalLength += c.length;
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  if (inputSampleRate === 16000) return merged;

  const ratio = inputSampleRate / 16000;
  const newLength = Math.max(1, Math.round(merged.length / ratio));
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(merged.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += merged[j];
      count++;
    }
    result[i] = count > 0 ? sum / count : 0;
  }
  return result;
}

export interface WhisperAudioSession {
  stopAndExtract16kHz: () => Float32Array;
  abort: () => void;
}

export async function startWhisperDspCapture(callbacks: {
  onSnrUpdate: (snrDb: number) => void;
  onEqBarsUpdate: (bars: number[]) => void;
  onMaxDurationReached?: (pcm16k: Float32Array) => void;
}): Promise<WhisperAudioSession> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  let ctx: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let rafId: number | null = null;
  let maxTimer: number | null = null;
  let stopped = false;
  const pcmChunks: Float32Array[] = [];
  let sampleRate = 48000;

  const cleanup = () => {
    stopped = true;
    if (maxTimer !== null) {
      window.clearTimeout(maxTimer);
      maxTimer = null;
    }
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    try {
      processor?.disconnect();
    } catch {
      // Ignore
    } finally {
      processor = null;
      stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // Ignore
        }
      });
      if (ctx && ctx.state !== 'closed') {
        ctx.close().catch(() => {});
      }
      ctx = null;
    }
  };

  try {
    ctx = new AudioCtx();
    sampleRate = ctx.sampleRate;

    const source = ctx.createMediaStreamSource(stream);

    const highPass = ctx.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = 100;

    const lowPass = ctx.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.value = 3400;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;

    processor = ctx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      if (!stopped) {
        pcmChunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      }
    };

    source.connect(highPass);
    highPass.connect(lowPass);
    lowPass.connect(analyser);
    lowPass.connect(processor);
    processor.connect(ctx.destination);

    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const timeData = new Float32Array(analyser.fftSize);
    let noiseFloor = 0.008;

    const renderMeter = () => {
      if (stopped) return;
      analyser.getByteFrequencyData(freqData);
      analyser.getFloatTimeDomainData(timeData);
      let sumSq = 0;
      for (let i = 0; i < timeData.length; i++) sumSq += timeData[i] * timeData[i];
      const rms = Math.sqrt(sumSq / timeData.length);
      if (rms > 0.0005 && rms < noiseFloor) noiseFloor = rms;
      const snr = Math.max(
        0,
        Math.min(36, Math.round(20 * Math.log10((rms + 0.0001) / (noiseFloor + 0.0001))))
      );
      callbacks.onSnrUpdate(snr);
      callbacks.onEqBarsUpdate(
        Array.from(freqData.slice(0, 10)).map((v) =>
          Math.max(14, Math.min(100, Math.round((v / 255) * 100)))
        )
      );
      rafId = requestAnimationFrame(renderMeter);
    };
    renderMeter();

    maxTimer = window.setTimeout(() => {
      if (stopped) return;
      const snapshot = pcmChunks.slice();
      cleanup();
      callbacks.onMaxDurationReached?.(downsampleTo16kHz(snapshot, sampleRate));
    }, MAX_RECORDING_MS);
  } catch (err) {
    cleanup();
    throw err;
  }

  return {
    stopAndExtract16kHz: () => {
      const snapshot = pcmChunks.slice();
      cleanup();
      return downsampleTo16kHz(snapshot, sampleRate);
    },
    abort: () => {
      cleanup();
    },
  };
}
