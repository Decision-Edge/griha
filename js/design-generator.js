/**
 * GRIHA DESIGN GENERATOR
 * ======================
 * Generates 4 distinct design options per room — no image API needed.
 * Each option is a rich concept with colours, furniture, lighting,
 * wallpaper, Vastu rationale, budget estimate, and matched products.
 *
 * TO ADD PHOTOREALISTIC RENDERS (optional upgrade):
 *   1. Get an OpenAI API key at platform.openai.com
 *   2. Add it as secret OPENAI_API_KEY in your Cloudflare Worker
 *   3. Set ENABLE_AI_RENDERS = true below
 *   Cost: ~₹13 per room (4 renders × $0.04 each)
 *
 * TO ADD A NEW DESIGN STYLE:
 *   Add an object to DESIGN_STYLES following the same schema.
 *   No other code changes needed.
 */

// ─── Set to true after adding OPENAI_API_KEY to your Cloudflare Worker ───────
export const ENABLE_AI_RENDERS = false;

// ─── All design styles ────────────────────────────────────────────────────────
export const DESIGN_STYLES = [
  {
    id: 'contemporary_indian',
    name: 'Contemporary Indian',
    tagline: 'Modern sensibility, rooted in Indian craft',
    description: 'Clean lines meet handcrafted warmth — solid sheesham wood, brass accents, handloom textiles and earthy terracotta tones. A distinctly Indian modernism that feels both sophisticated and familiar.',
    colours: {
      wall:        { name: 'Kaolin Clay',   hex: '#EAE1D5', paint_code: 'Asian Paints 9282', berger_code: 'P110-2' },
      accent_wall: { name: 'Fired Clay',    hex: '#C47040', paint_code: 'Asian Paints 7167', berger_code: 'O130-5' },
      trim:        { name: 'Teak Brown',    hex: '#8E6D4E', paint_code: 'Asian Paints 7155' },
      furniture:   { name: 'Deep Mahogany', hex: '#5C3D2C' }
    },
    wallpaper: { description: 'Subtle linen texture or hand-block print on one accent wall', pattern: 'geometric block print', vendor: 'Asian Paints Royale Play' },
    furniture_style: 'solid sheesham / teak wood, Indian craftsmanship',
    lighting_style: 'warm brass pendant, sheesham floor lamp',
    textile_style: 'handloom cotton, block print cushions, dhurrie rug',
    vastu_strengths: ['Warm earth tones anchor SW zone earth element', 'Natural wood grounds Nairutya energy', 'Brass accents support north zone prosperity'],
    budget_range: { low: 180000, high: 350000 },
    product_tags: ['contemporary_indian', 'wooden', 'traditional', 'handcrafted'],
    carpenter: {
      carcass_material: '18mm BWR Grade Plywood (Century Ply / Green Ply)',
      shutter_material: '18mm MDF with teak veneer or warm wood-grain laminate',
      hardware: 'Antique brass bar handles, Hettich soft-close hinges',
      finish: 'PU coating in warm satin finish'
    }
  },
  {
    id: 'minimalist_modern',
    name: 'Minimalist Modern',
    tagline: 'Calm, curated, clutter-free',
    description: 'White and warm grey with one strong accent colour. Maximum hidden storage, clean furniture lines, and deliberate negative space. Timeless and easy to maintain.',
    colours: {
      wall:        { name: 'Linen White',    hex: '#F5F0E8', paint_code: 'Asian Paints 9011', berger_code: 'W150-2' },
      accent_wall: { name: 'Cerulean',       hex: '#5B8FAE', paint_code: 'Asian Paints 7389', berger_code: 'B140-5' },
      trim:        { name: 'Warm Grey',      hex: '#B4B2A9', paint_code: 'Asian Paints 8200' },
      furniture:   { name: 'Charcoal',       hex: '#2C2C2A' }
    },
    wallpaper: { description: 'Subtle embossed white texture on feature wall — no colour, only depth', pattern: 'geometric emboss', vendor: 'Nilaya by Asian Paints' },
    furniture_style: 'engineered wood, white / light grey upholstery, hidden storage',
    lighting_style: 'recessed LED downlights + slim black pendant over key zones',
    textile_style: 'linen, cotton, solid-colour throws and cushions',
    vastu_strengths: ['White maximises light — ideal for N and E zone rooms', 'Blue accent supports Varuna water element (W zone)', 'Clutter-free design supports positive energy flow per Manasara Ch. 12'],
    budget_range: { low: 120000, high: 250000 },
    product_tags: ['minimalist', 'modern', 'scandinavian'],
    carpenter: {
      carcass_material: '18mm MR Grade Plywood',
      shutter_material: '18mm MDF with acrylic or high-gloss white laminate',
      hardware: 'Stainless steel bar handles, Hettich push-to-open',
      finish: 'Matt or satin white with zero-gap shutters'
    }
  },
  {
    id: 'traditional_heritage',
    name: 'Traditional Heritage',
    tagline: 'The grandeur of classical Indian interiors',
    description: 'Carved wooden furniture, rich jewel tones, jali screens and traditional Indian motifs. For families who value heritage and want their home to feel connected to Indian history.',
    colours: {
      wall:        { name: 'Pale Peach',   hex: '#F5ECE1', paint_code: 'Asian Paints 9183', berger_code: 'O130-1' },
      accent_wall: { name: 'Brick Spice',  hex: '#9A4820', paint_code: 'Asian Paints 6154', berger_code: 'O130-7' },
      trim:        { name: 'Warm Gold',    hex: '#B07D20', paint_code: 'Asian Paints 7100' },
      furniture:   { name: 'Dark Walnut',  hex: '#3D2314' }
    },
    wallpaper: { description: 'Traditional Indian damask or floral print on the main wall', pattern: 'Indian damask / floral', vendor: 'Wallskin India / Asian Paints Royale Play' },
    furniture_style: 'carved wood, Rajasthani-style joinery, antique brass fittings',
    lighting_style: 'antique brass chandelier, lantern-style wall sconces',
    textile_style: 'silk, brocade, traditional block-printed cotton',
    vastu_strengths: ['Warm tones honour SE fire element per Samarangana Sutradhara Ch. 18', 'Carved wood grounds SW zone earth energy', 'Traditional motifs align with classical Vastu spatial principles'],
    budget_range: { low: 280000, high: 600000 },
    product_tags: ['traditional', 'contemporary_indian', 'rajasthani', 'premium'],
    carpenter: {
      carcass_material: '18mm BWP Waterproof Plywood',
      shutter_material: 'Solid teak with carved panel inserts (jali or floral)',
      hardware: 'Antique brass ring pulls, solid brass hinges',
      finish: 'Teak oil polish or PU satin finish in dark walnut'
    }
  },
  {
    id: 'boho_chic',
    name: 'Boho Chic',
    tagline: 'Eclectic warmth with a global soul',
    description: 'Rattan, cane, macramé, indoor plants, and a relaxed layering of Indian and global textiles. Maximally personal, affordable, and the easiest style to evolve over time.',
    colours: {
      wall:        { name: 'Morning Mist', hex: '#E8EEE6', paint_code: 'Asian Paints 9341', berger_code: 'G120-1' },
      accent_wall: { name: 'Herb Garden',  hex: '#779971', paint_code: 'Asian Paints 7220', berger_code: 'G120-5' },
      trim:        { name: 'Pale Sage',    hex: '#B5CDAC', paint_code: 'Asian Paints 8334' },
      furniture:   { name: 'Natural Rattan', hex: '#C8A882' }
    },
    wallpaper: { description: 'Large-leaf botanical print or grasscloth texture on accent wall', pattern: 'botanical / grasscloth', vendor: 'Nilaya by Asian Paints / D\'Décor' },
    furniture_style: 'rattan, cane, natural wood, eclectic mix',
    lighting_style: 'rattan woven pendant, warm Edison-bulb floor lamp',
    textile_style: 'macramé wall hanging, dhurrie rug, mixed global textiles',
    vastu_strengths: ['Green tones align with NE prosperity zone per Manasara', 'Natural rattan supports earth element', 'Indoor plants in NE corner are Vastu-recommended for positive energy'],
    budget_range: { low: 90000, high: 200000 },
    product_tags: ['boho', 'handcrafted', 'contemporary_indian', 'botanical'],
    carpenter: {
      carcass_material: '18mm MR Grade Plywood',
      shutter_material: 'Cane webbing panel on MDF frame, or natural wood-look laminate',
      hardware: 'Wooden knobs or rope pulls (natural materials)',
      finish: 'Natural oil finish or matt white base with cane panel shutters'
    }
  }
];

// ─── DesignGenerator class ────────────────────────────────────────────────────

export class DesignGenerator {
  constructor(catalog) {
    this.catalog = catalog;
  }

  /**
   * Generate all 4 design options for a room.
   * Returns instantly — no API call. Products are loaded async per option.
   */
  generateOptions({ room_type, compass_zone, ai_observations = {}, vastu_result = {} }) {
    return DESIGN_STYLES.map(style => ({
      style,
      vastu_fit_score: this._scoreStyleForZone(style, compass_zone),
      budget_estimate: this._estimateBudget(style, ai_observations.estimated_sqft || 150),
      key_features:    this._buildKeyFeatures(style, ai_observations, compass_zone),
      design_brief:    this._buildDesignBrief(style, room_type, compass_zone, ai_observations),
      products:        null, // loaded on demand when user selects
      isSelected:      false
    }));
  }

  /**
   * Load matched products for a selected design option.
   * Called only when user clicks "Select this design".
   */
  async loadProducts(option, room_type, compass_zone) {
    const tags = option.style.product_tags;

    const [furniture, lighting, wallDecor, accessories] = await Promise.all([
      this.catalog.getRecommendations({ room_type, vastu_zone: compass_zone, style_tags: tags, category_filter: 'furniture',   max_results: 4 }),
      this.catalog.getRecommendations({ room_type, vastu_zone: compass_zone, style_tags: tags, category_filter: 'lighting',    max_results: 3 }),
      this.catalog.getRecommendations({ room_type, vastu_zone: compass_zone, style_tags: tags, category_filter: 'wall_decor',  max_results: 3 }),
      this.catalog.getRecommendations({ room_type, vastu_zone: compass_zone, style_tags: tags, category_filter: 'accessories', max_results: 4 })
    ]);

    return { furniture, lighting, wallDecor, accessories };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  _scoreStyleForZone(style, zone) {
    const affinities = {
      contemporary_indian: { SW:95, S:88, SE:85, E:82 },
      minimalist_modern:   { N:92, NE:90, E:88, NW:85 },
      traditional_heritage:{ SW:90, S:88, W:85, SE:82 },
      boho_chic:           { NE:92, N:88, E:85, NW:82 }
    };
    return (affinities[style.id] || {})[zone] || 76;
  }

  _estimateBudget(style, sqft) {
    const scale = Math.max(0.7, Math.min(2.0, sqft / 150));
    const fmt = n => '₹' + Math.round(n * scale / 1000) * 1000 .toLocaleString('en-IN');
    return `${fmt(style.budget_range.low)} – ${fmt(style.budget_range.high)}`;
  }

  _buildKeyFeatures(style, obs, zone) {
    const f = [
      `Wall: ${style.colours.wall.name} + ${style.colours.accent_wall.name} accent`,
      `Furniture: ${style.furniture_style}`,
      `Lighting: ${style.lighting_style}`,
      `Wallpaper: ${style.wallpaper.description}`,
    ];
    if (obs?.overhead_beams_detected) f.push('Beam fix included in spec');
    if (zone && zone !== 'unknown') f.push(`Vastu (${zone}): ${style.vastu_strengths[0]}`);
    return f;
  }

  _buildDesignBrief(style, room_type, zone, obs) {
    return {
      room_type,
      compass_zone: zone,
      style_id:     style.id,
      wall_colour:  style.colours.wall,
      accent_wall:  style.colours.accent_wall,
      wallpaper:    style.wallpaper,
      lighting:     style.lighting_style,
      furniture:    style.furniture_style,
      textiles:     style.textile_style,
      sqft:         obs?.estimated_sqft,
      carpenter:    style.carpenter
    };
  }
}
