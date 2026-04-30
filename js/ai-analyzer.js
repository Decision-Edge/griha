/**
 * GRIHA AI ANALYZER — client-side module
 * Sends images to the Cloudflare Worker and returns structured results.
 *
 * UPDATE THIS URL to your worker after deploying worker/index.js:
 */
const WORKER_URL = 'https://griha-worker.sayan-biz000.workers.dev';

export class AIAnalyzer {
  constructor(url = WORKER_URL) {
    this.workerUrl = url;
  }

  // Test if the worker is reachable and what services are available
  async testConnection() {
    try {
      const r = await fetch(`${this.workerUrl}/health`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return { ok:false, error:`Worker returned ${r.status}` };
      const d = await r.json();
      return { ok:true, ...d };
    } catch(e) {
      return { ok:false, error:e.message };
    }
  }

  // Validate: is this a room photo?
  async validatePhoto(file) {
    try {
      const { base64, mime } = await fileToBase64(file);
      const r = await post(`${this.workerUrl}/validate-photo`, { imageBase64:base64, mimeType:mime });
      if (!r.ok) return { ok:true, is_valid_room:true, _skipped:true }; // fail open
      const d = await r.json();
      if (typeof d.is_valid_room !== 'boolean') return { ok:true, is_valid_room:true, _skipped:true };
      return { ok:true, ...d };
    } catch(e) {
      return { ok:true, is_valid_room:true, _skipped:true }; // network error → accept
    }
  }

  // Full room analysis
  async analyzeRoom(file, roomLabel) {
    try {
      const { base64, mime } = await fileToBase64(file);
      const r = await post(`${this.workerUrl}/analyze-room`, { imageBase64:base64, mimeType:mime, roomLabel });
      const d = await r.json();
      if (!d.room_identified) return { ok:false, error: d.error || 'Could not identify room in photo' };
      return { ok:true, ...d };
    } catch(e) {
      return { ok:false, error:e.message };
    }
  }

  // Masterplan compass zone analysis — resizes before sending to stay within Anthropic limits
  async analyzeMasterplan(file) {
    try {
      // Resize to max 1600px — floor plans can be very large, Anthropic rejects >5MB
      const base64 = await resizeMax(file, 1600);
      const r = await post(`${this.workerUrl}/analyze-masterplan`, {
        imageBase64: base64,
        mimeType:    'image/jpeg'
      });
      if (!r.ok) return { ok:false, error:`Masterplan service returned ${r.status}` };
      const d = await r.json();
      if (!d.plan_identified) return { ok:false, error:
        d.error === 'not_a_floorplan'  ? 'This does not look like a floor plan. Please upload your builder masterplan image.' :
        d.error === 'image_too_large'  ? 'Floor plan image is too large. Please use a smaller image.' :
        'Could not read this floor plan. Please ensure it clearly shows room layouts.'
      };
      return { ok:true, ...d };
    } catch(e) {
      return { ok:false, error:e.message };
    }
  }

  // AI render — img2img transforms the user's actual room photo
  async generateRender({ room_type, design_style_id, palette_id, compass_zone, room_sqft, roomPhotoFile }) {
    try {
      let roomImageBase64 = null;
      let roomMimeType    = 'image/jpeg';

      if (roomPhotoFile) {
        // SD v1.5 img2img requires 512×512 input.
        // We square-crop from the centre so the room proportions are maintained
        // as much as possible within the square constraint.
        roomImageBase64 = await resizeSquare(roomPhotoFile, 512);
        roomMimeType    = 'image/jpeg';
      }

      const r = await post(`${this.workerUrl}/generate-render`, {
        room_type, design_style_id, palette_id, compass_zone, room_sqft,
        roomImageBase64,
        roomMimeType,
      });
      if (!r.ok) return { ok:false, error:`Render service returned ${r.status}` };
      const d = await r.json();
      if (!d.ok) return { ok:false, error: d.error || 'Render failed' };
      return d;
    } catch(e) {
      return { ok:false, error:e.message };
    }
  }

  // Conversational chat
  async chat(userMessage, context, history=[]) {
    try {
      const r = await post(`${this.workerUrl}/suggest-changes`, {
        userMessage,
        currentAnalysis: context,
        conversationHistory: history.slice(-8)
      });
      const d = await r.json();
      if (!d.ok) return { ok:false, error: d.error || 'AI did not respond' };
      return d;
    } catch(e) {
      return { ok:false, error:e.message };
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Resize to max dimension preserving aspect ratio — for masterplans and room photos
function resizeMax(file, maxPx) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width <= maxPx && height <= maxPx) {
        // Already small enough — just convert to base64
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.readAsDataURL(file);
        return;
      }
      const ratio  = Math.min(maxPx / width, maxPx / height);
      width        = Math.round(width  * ratio);
      height       = Math.round(height * ratio);
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.90).split(',')[1]);
    };
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = url;
  });
}
  return fetch(url, {
    method:  'POST',
    headers: { 'Content-Type':'application/json' },
    body:    JSON.stringify(body)
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve({ base64: reader.result.split(',')[1], mime: file.type });
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function resizeSquare(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas    = document.createElement('canvas');
      canvas.width    = size;
      canvas.height   = size;
      const ctx       = canvas.getContext('2d');
      const minDim    = Math.min(img.width, img.height);
      const sx        = (img.width  - minDim) / 2;
      const sy        = (img.height - minDim) / 2;
      ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', 0.9).split(',')[1]);
    };
    img.onerror = () => reject(new Error('Could not load image'));
    img.src     = url;
  });
}
