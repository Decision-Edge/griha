/**
 * GRIHA PALETTE ENGINE
 * ====================
 * Pure logic module. No API calls, no DOM access.
 *
 * TO IMPROVE THIS MODULE:
 *   — Add new palettes in data/palettes.json only.
 *   — Add new vendor links inside each palette's "vendors" array.
 *   — To support Asian Paints API (when available): swap the
 *     vendor URL in each palette's vendors array to an API endpoint.
 *   — To add wallpaper suppliers: add a "wallpaper_vendors" array
 *     to each palette in palettes.json.
 *
 * INTERFACE:
 *   const engine = new PaletteEngine(palettesData);
 *   const result = engine.recommend({ zone, room_type, style_tags, max_results });
 */

export class PaletteEngine {
  constructor(palettesData) {
    if (!palettesData || !palettesData.palettes) {
      throw new Error('PaletteEngine: palettesData must contain a palettes array. Check data/palettes.json');
    }
    this.palettes = palettesData.palettes;
  }

  /**
   * Recommend palettes for a given room context.
   *
   * @param {object} opts
   * @param {string}   opts.zone          - Vastu zone e.g. "SW"
   * @param {string}   opts.room_type     - e.g. "master_bedroom"
   * @param {string[]} opts.style_tags    - e.g. ["modern", "minimalist"]
   * @param {number}   [opts.max_results] - default 3
   * @returns {ScoredPalette[]}
   */
  recommend({ zone, room_type, style_tags = [], max_results = 3 } = {}) {
    const scored = this.palettes.map(palette => ({
      ...palette,
      _score: this._scorePalette(palette, { zone, room_type, style_tags })
    }));

    // Sort by score descending, take top N
    scored.sort((a, b) => b._score - a._score);
    return scored.slice(0, max_results).map(p => {
      const { _score, ...clean } = p;
      return clean;
    });
  }

  /**
   * Get a single palette by ID.
   * Useful for when a user selects a specific palette.
   */
  getById(id) {
    return this.palettes.find(p => p.id === id) || null;
  }

  /**
   * Returns all palettes compatible with a zone — no scoring, no filtering.
   * Useful for displaying a full catalogue.
   */
  getAllForZone(zone) {
    return this.palettes.filter(p =>
      p.zones.includes('ALL') || p.zones.includes(zone)
    );
  }

  /**
   * Scores a palette against the room context.
   * Higher is better.
   *
   * Scoring logic:
   *   +3  exact zone match
   *   +2  room_type match
   *   +1  per matching style_tag
   *   +1  if zone is 'ALL' (universal palettes)
   *   0   no match (palette still returned if nothing better exists)
   */
  _scorePalette(palette, { zone, room_type, style_tags }) {
    let score = 0;

    if (palette.zones.includes('ALL')) score += 1;
    if (zone && palette.zones.includes(zone)) score += 3;

    if (room_type) {
      const roomMatch = palette.room_types.includes('ALL') || palette.room_types.includes(room_type);
      if (roomMatch) score += 2;
    }

    if (style_tags && style_tags.length > 0) {
      style_tags.forEach(tag => {
        if (palette.style_tags.includes(tag)) score += 1;
      });
    }

    return score;
  }

  /**
   * Given a hex colour from AI room analysis (existing wall colour),
   * suggests palettes that harmonise with it.
   * Simple implementation: checks colour_family alignment.
   */
  recommendForExistingColour(existingColourName, zone) {
    const warm = ['cream', 'beige', 'terracotta', 'orange', 'yellow', 'brown', 'red', 'warm'];
    const cool  = ['white', 'grey', 'blue', 'green', 'teal', 'mint'];

    const existingIsWarm = warm.some(w => existingColourName.toLowerCase().includes(w));

    return this.palettes.filter(palette => {
      const familyIsWarm = warm.some(w => palette.swatches[0]?.hex && this._isWarmHex(palette.swatches[0].hex));
      return existingIsWarm === familyIsWarm;
    }).slice(0, 2);
  }

  /**
   * Simple warm/cool detection from hex.
   * A rough heuristic — red+green channels vs blue channel.
   */
  _isWarmHex(hex) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return (r + g * 0.5) > (b * 1.2);
  }
}
