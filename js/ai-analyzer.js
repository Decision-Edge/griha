/**
 * GRIHA AI ANALYZER
 * =================
 * Client-side module that sends images to the secure backend worker
 * and returns structured analysis data.
 *
 * TO IMPROVE THIS MODULE:
 *   — Update WORKER_URL to your deployed Cloudflare Worker URL.
 *   — The actual AI prompts live in worker/index.js — edit them there.
 *   — To switch AI providers (e.g. OpenAI Vision, Gemini):
 *     update worker/index.js only. This file's interface stays the same.
 *   — To add a new analysis type: add a new method here + new route in worker.
 *
 * GUARDRAILS BUILT IN:
 *   — Image size check before sending (max 5MB)
 *   — Confidence threshold check (rejects 'low' confidence by default)
 *   — JSON schema validation on response
 *   — Graceful error objects (never throws raw errors to UI)
 */

// ─── CONFIGURE THIS ───────────────────────────────────────────────────────────
// Replace with your Cloudflare Worker URL after deploying worker/index.js
// Format: https://griha-worker.<your-cloudflare-username>.workers.dev
const WORKER_URL = 'https://griha-worker.sayan-biz000.workers.dev';
// ─────────────────────────────────────────────────────────────────────────────

const MAX_IMAGE_BYTES  = 5 * 1024 * 1024; // 5MB
const MIN_CONFIDENCE   = 'medium';         // reject 'low' confidence responses

export class AIAnalyzer {
  constructor(workerUrl = WORKER_URL) {
    this.workerUrl = workerUrl;
  }

  /**
   * Step 1: Validate a photo before full analysis.
   * Fast and cheap — just checks if it's a room photo.
   *
   * @param {File} imageFile
   * @returns {Promise<{ok, is_valid_room, room_type_detected, reason}>}
   */
  async validatePhoto(imageFile) {
    // Size and type guards — these reject before hitting the network
    if (imageFile.size > MAX_IMAGE_BYTES) {
      return { ok:true, is_valid_room:true, _skipped:true }; // don't block on size, analyzeRoom will catch it
    }
    const allowedTypes = ['image/jpeg','image/png','image/webp'];
    if (!allowedTypes.includes(imageFile.type)) {
      // Show a real error for wrong format
      return this._error('Unsupported format. Please use JPG, PNG, or WebP.');
    }
    try {
      const { base64, mimeType } = await this._fileToBase64(imageFile);
      const response = await fetch(`${this.workerUrl}/validate-photo`, {
        method:  'POST',
        headers: { 'Content-Type':'application/json' },
        body:    JSON.stringify({ imageBase64:base64, mimeType })
      });
      // Non-200 from worker → skip validation, don't reject photo
      if (!response.ok) {
        console.warn('Validation endpoint returned', response.status, '— skipping validation');
        return { ok:true, is_valid_room:true, _skipped:true };
      }
      const data = await response.json();
      // Malformed response → skip validation
      if (typeof data.is_valid_room !== 'boolean') {
        console.warn('Validation response malformed — skipping');
        return { ok:true, is_valid_room:true, _skipped:true };
      }
      return { ok:true, ...data };
    } catch(err) {
      // Network error / worker not deployed → skip validation silently
      console.warn('Photo validation skipped:', err.message);
      return { ok:true, is_valid_room:true, _skipped:true };
    }
  }

  /**
   * Step 2: Full room analysis — light, beams, electrical, style, Vastu observations.
   */
  async analyzeRoom(imageFile, roomLabel) {
    // GUARDRAIL 1: File size check
    if (imageFile.size > MAX_IMAGE_BYTES) {
      return this._error('Image is too large. Please use a photo under 5MB.');
    }

    // GUARDRAIL 2: File type check
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(imageFile.type)) {
      return this._error('Unsupported image format. Please use JPG, PNG, or WebP.');
    }

    try {
      const { base64, mimeType } = await this._fileToBase64(imageFile);

      const response = await fetch(`${this.workerUrl}/analyze-room`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageBase64: base64, mimeType, roomLabel })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return this._error(err.error || `Worker returned status ${response.status}`);
      }

      const data = await response.json();

      // GUARDRAIL 3: Schema validation
      if (!this._validateRoomSchema(data)) {
        return this._error('AI returned an unexpected response format. Please retry.');
      }

      // GUARDRAIL 4: Confidence threshold
      if (data.confidence === 'low' || data.error) {
        return this._error(
          data.error === 'image_unclear' ? 'The image is unclear or too dark. Please upload a brighter photo.' :
          data.error === 'not_a_room'    ? 'This does not appear to be a room interior. Please upload a room photo.' :
          data.error === 'too_dark'      ? 'The photo is too dark to analyse. Please use a well-lit photo.' :
          'The AI could not confidently analyse this image. Please try a different photo.'
        );
      }

      return { ok: true, ...data };

    } catch (err) {
      // GUARDRAIL 5: Network error — give actionable message
      if (err.message?.includes('fetch')) {
        return this._error('Could not reach the analysis service. Check your internet connection and ensure the worker is deployed.');
      }
      return this._error(`Analysis failed: ${err.message}`);
    }
  }

  /**
   * Analyse a builder masterplan image.
   *
   * @param {File} imageFile
   * @returns {Promise<MasterplanAnalysis>}
   */
  async analyzeMasterplan(imageFile) {
    if (imageFile.size > MAX_IMAGE_BYTES) {
      return this._error('Masterplan image is too large. Please use an image under 5MB.');
    }

    try {
      const { base64, mimeType } = await this._fileToBase64(imageFile);

      const response = await fetch(`${this.workerUrl}/analyze-masterplan`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageBase64: base64, mimeType })
      });

      if (!response.ok) {
        return this._error(`Masterplan service returned ${response.status}. Check your Worker is deployed.`);
      }

      const data = await response.json();

      // parse_failed means Claude returned something unexpected
      if (data.error === 'parse_failed') {
        return this._error('Could not read compass directions from this image. Try uploading a clearer, higher-contrast version of the floor plan.');
      }

      if (!data.plan_identified) {
        return this._error(
          data.error === 'not_a_floorplan' ? 'This does not appear to be a floor plan. Please upload your builder masterplan PDF or image.' :
          data.error === 'image_unclear'    ? 'The floor plan image is too blurry to read. Please use a higher-resolution image.' :
          'Could not read this floor plan. Please ensure it shows room layouts clearly.'
        );
      }

      return { ok: true, ...data };

    } catch (err) {
      return this._error(`Could not reach the analysis service: ${err.message}. Check your internet connection and ensure the Worker is deployed.`);
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Generate an AI room render using Stable Diffusion XL via the Worker.
   *
   * @param {object} params
   * @param {string} params.room_type        - e.g. "master_bedroom"
   * @param {string} params.design_style_id  - e.g. "contemporary_indian"
   * @param {string} params.compass_zone     - e.g. "SW"
   * @param {number} params.room_sqft        - e.g. 160
   * @returns {Promise<{ok, image_base64, mime_type} | {ok:false, error}>}
   */
  /**
   * Generate an AI room render using the uploaded photo as the base (img2img).
   * The selected style and palette are applied ON TOP of the actual room photo.
   *
   * @param {object} params
   * @param {string} params.room_type
   * @param {string} params.design_style_id
   * @param {string} params.compass_zone
   * @param {number} params.room_sqft
   * @param {string} params.palette_desc
   * @param {File}   [params.roomPhotoFile]  — the actual uploaded room photo File object
   */
  async generateRender({ room_type, design_style_id, compass_zone, room_sqft, palette_id='', palette_desc='', roomPhotoFile=null }) {
    try {
      let roomImageBase64 = null;
      let roomMimeType    = 'image/jpeg';
      if (roomPhotoFile) {
        // Resize image client-side before sending to reduce payload
        const resized = await this._resizeImage(roomPhotoFile, 768, 768);
        roomImageBase64 = resized.base64;
        roomMimeType    = resized.mimeType;
      }
      const response = await fetch(`${this.workerUrl}/generate-render`, {
        method:  'POST',
        headers: { 'Content-Type':'application/json' },
        body:    JSON.stringify({ room_type, design_style_id, compass_zone, room_sqft, palette_id, palette_desc, roomImageBase64, roomMimeType })
      });
      const data = await response.json();
      if (!data.ok) return { ok: false, error: data.error || 'Render generation failed' };
      return data;
    } catch (err) {
      return { ok: false, error: `Could not generate render: ${err.message}` };
    }
  }

  /**
   * Send a chat message to the conversational assistant.
   *
   * @param {string}   userMessage
   * @param {object}   currentAnalysis  - context from current room
   * @param {array}    conversationHistory
   * @returns {Promise<{ok, reply} | {ok:false, error}>}
   */
  async chat(userMessage, currentAnalysis = null, conversationHistory = []) {
    try {
      const response = await fetch(`${this.workerUrl}/suggest-changes`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ userMessage, currentAnalysis, conversationHistory })
      });
      const data = await response.json();
      if (data.error) return { ok: false, error: data.error };
      return { ok: true, reply: data.reply || 'No response generated.' };
    } catch (err) {
      return { ok: false, error: `Chat unavailable: ${err.message}` };
    }
  }

  /**
   * Resizes an image client-side before sending to reduce payload size.
   * SD img2img works well at 512-768px — no need to send full 4K photos.
   */
  async _resizeImage(file, maxW=768, maxH=768) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        const ratio = Math.min(maxW/width, maxH/height, 1);
        width  = Math.round(width  * ratio);
        height = Math.round(height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const mimeType = 'image/jpeg';
        const base64   = canvas.toDataURL(mimeType, 0.85).split(',')[1];
        resolve({ base64, mimeType, width, height });
      };
      img.onerror = () => reject(new Error('Could not load image for resizing'));
      img.src = url;
    });
  }

  /**
   * Converts a browser File to base64 string.
   */
  _fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve({
        base64:   reader.result.split(',')[1],
        mimeType: file.type
      });
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Validates that the room analysis response has the expected shape.
   * GUARDRAIL: never pass unvalidated AI output to the Vastu engine.
   */
  _validateRoomSchema(data) {
    return (
      typeof data === 'object' &&
      data !== null &&
      typeof data.room_identified === 'boolean' &&
      typeof data.confidence === 'string'
    );
  }

  _error(message) {
    return { ok: false, error: message, room_identified: false, observations: {} };
  }
}
