/**
 * GRIHA AI ANALYZER — client-side module
 * Uses ES Modules (import/export)
 */

const WORKER_URL = 'https://griha-worker.sayan-biz000.workers.dev';

export class AIAnalyzer {
  constructor(url = WORKER_URL) {
    this.workerUrl = url;
  }

  // ── Health Check ─────────────────────────────────────
  async testConnection() {
    try {
      const r = await fetch(`${this.workerUrl}/health`, {
        signal: AbortSignal.timeout(5000)
      });

      if (!r.ok) {
        return { ok: false, error: `Worker returned ${r.status}` };
      }

      const d = await r.json();
      return { ok: true, ...d };

    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ── Validate Room Photo ──────────────────────────────
  async validatePhoto(file) {
    try {
      const { base64, mime } = await fileToBase64(file);

      const r = await post(`${this.workerUrl}/validate-photo`, {
        imageBase64: base64,
        mimeType: mime
      });

      if (!r.ok) {
        return { ok: true, is_valid_room: true, _skipped: true };
      }

      const d = await r.json();

      if (typeof d.is_valid_room !== 'boolean') {
        return { ok: true, is_valid_room: true, _skipped: true };
      }

      return { ok: true, ...d };

    } catch (e) {
      return { ok: true, is_valid_room: true, _skipped: true };
    }
  }

  // ── Room Analysis ────────────────────────────────────
  async analyzeRoom(file, roomLabel) {
    try {
      const { base64, mime } = await fileToBase64(file);

      const r = await post(`${this.workerUrl}/analyze-room`, {
        imageBase64: base64,
        mimeType: mime,
        roomLabel
      });

      const d = await r.json();

      if (!d.room_identified) {
        return {
          ok: false,
          error: d.error || 'Could not identify room in photo'
        };
      }

      return { ok: true, ...d };

    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ── Masterplan Analysis ──────────────────────────────
  async analyzeMasterplan(file) {
    try {
      const base64 = await resizeMax(file, 1600);

      const r = await post(`${this.workerUrl}/analyze-masterplan`, {
        imageBase64: base64,
        mimeType: 'image/jpeg'
      });

      if (!r.ok) {
        return { ok: false, error: `Service returned ${r.status}` };
      }

      const d = await r.json();

      if (!d.plan_identified) {
        return {
          ok: false,
          error:
            d.error === 'not_a_floorplan'
              ? 'This does not look like a floor plan.'
              : d.error === 'image_too_large'
              ? 'Image too large.'
              : 'Could not read this floor plan.'
        };
      }

      return { ok: true, ...d };

    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ── Render Generation ────────────────────────────────
  async generateRender({
    room_type,
    design_style_id,
    palette_id,
    compass_zone,
    room_sqft,
    roomPhotoFile
  }) {
    try {
      let roomImageBase64 = null;

      if (roomPhotoFile) {
        roomImageBase64 = await resizeSquare(roomPhotoFile, 512);
      }

      const r = await post(`${this.workerUrl}/generate-render`, {
        room_type,
        design_style_id,
        palette_id,
        compass_zone,
        room_sqft,
        roomImageBase64,
        roomMimeType: 'image/jpeg'
      });

      if (!r.ok) {
        return { ok: false, error: `Render failed ${r.status}` };
      }

      const d = await r.json();

      if (!d.ok) {
        return { ok: false, error: d.error || 'Render failed' };
      }

      return d;

    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ── Chat ─────────────────────────────────────────────
  async chat(userMessage, context, history = []) {
    try {
      const r = await post(`${this.workerUrl}/suggest-changes`, {
        userMessage,
        currentAnalysis: context,
        conversationHistory: history.slice(-8)
      });

      const d = await r.json();

      if (!d.ok) {
        return { ok: false, error: d.error || 'No response' };
      }

      return d;

    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
}

// ── Helpers ────────────────────────────────────────────

function post(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () =>
      resolve({
        base64: reader.result.split(',')[1],
        mime: file.type
      });

    reader.onerror = () => reject(new Error('File read error'));

    reader.readAsDataURL(file);
  });
}

function resizeMax(file, maxPx) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;

      if (width <= maxPx && height <= maxPx) {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(new Error('Read error'));
        reader.readAsDataURL(file);
        return;
      }

      const ratio = Math.min(maxPx / width, maxPx / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      canvas.getContext('2d').drawImage(img, 0, 0, width, height);

      resolve(canvas.toDataURL('image/jpeg', 0.9).split(',')[1]);
    };

    img.onerror = () => reject(new Error('Image load error'));
    img.src = url;
  });
}

function resizeSquare(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;

      const ctx = canvas.getContext('2d');

      const minDim = Math.min(img.width, img.height);
      const sx = (img.width - minDim) / 2;
      const sy = (img.height - minDim) / 2;

      ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);

      resolve(canvas.toDataURL('image/jpeg', 0.9).split(',')[1]);
    };

    img.onerror = () => reject(new Error('Image load error'));
    img.src = url;
  });
}
