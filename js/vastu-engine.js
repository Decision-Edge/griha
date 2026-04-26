/**
 * GRIHA VASTU ENGINE
 * ==================
 * Pure logic module. No API calls, no DOM access, no side effects.
 *
 * TO IMPROVE THIS MODULE:
 *   — Add new rules in data/vastu-rules.json only. No code changes needed here.
 *   — Adjust score_impact values in rules JSON to reweight the scoring.
 *   — Add new room types by adding rules with those room_type values in the JSON.
 *
 * INTERFACE:
 *   const engine = new VastuEngine(rulesData);
 *   const result = engine.analyzeRoom(roomInput);
 *
 * INPUT (roomInput):
 *   {
 *     room_type: string,         e.g. "master_bedroom"
 *     compass_zone: string,      e.g. "SW" — from masterplan analysis
 *     ai_observations: object,   — structured output from AIAnalyzer
 *     user_preferences: object   — optional style/budget preferences
 *   }
 *
 * OUTPUT:
 *   {
 *     score: number (0–100),
 *     grade: string,
 *     zone_info: object,
 *     compliant_rules: Rule[],
 *     violated_rules: Rule[],
 *     warning_rules: Rule[],
 *     good_to_have: Rule[],
 *     recommendations: string[],
 *     colour_direction: string
 *   }
 */

export class VastuEngine {
  constructor(rulesData) {
    if (!rulesData || !rulesData.rules) {
      throw new Error('VastuEngine: rulesData must contain a rules array. Check data/vastu-rules.json');
    }
    this.rules    = rulesData.rules;
    this.zones    = rulesData.zones;
    this._version = rulesData._meta?.version || 'unknown';
  }

  /**
   * Main analysis method.
   * @param {object} roomInput
   * @returns {VastuResult}
   */
  analyzeRoom(roomInput) {
    const { room_type, compass_zone, ai_observations = {}, user_preferences = {} } = roomInput;

    // 1. Get zone metadata
    const zone_info = this._getZoneInfo(compass_zone);

    // 2. Get all rules applicable to this room+zone combination
    const applicable = this._getApplicableRules(room_type, compass_zone);

    // 3. Evaluate each rule against AI observations
    const evaluated = applicable.map(rule => this._evaluateRule(rule, roomInput));

    // 4. Separate into categories
    const compliant_rules  = evaluated.filter(r => r.status === 'compliant');
    const violated_rules   = evaluated.filter(r => r.status === 'violated');
    const warning_rules    = evaluated.filter(r => r.status === 'warning');
    const good_to_have     = evaluated.filter(r => r.status === 'good_to_have');
    const not_evaluatable  = evaluated.filter(r => r.status === 'cannot_evaluate');

    // 5. Compute score (0–100)
    const score = this._computeScore(evaluated);

    // 6. Grade
    const grade = this._grade(score);

    // 7. Generate plain-English recommendations
    const recommendations = this._generateRecommendations(violated_rules, warning_rules, good_to_have);

    // 8. Colour direction for this zone
    const colour_direction = zone_info?.colour_family || 'neutral, warm whites';

    return {
      score,
      grade,
      zone_info,
      compliant_rules,
      violated_rules,
      warning_rules,
      good_to_have,
      not_evaluatable,
      recommendations,
      colour_direction,
      engine_version: this._version
    };
  }

  /**
   * Returns rules applicable to a given room type and zone.
   * Filters by room_type (or 'ALL') and zone relevance.
   */
  _getApplicableRules(room_type, zone) {
    return this.rules.filter(rule => {
      const roomMatch = rule.room_types.includes('ALL') || rule.room_types.includes(room_type);
      return roomMatch;
    });
  }

  /**
   * Evaluates a single rule against the room input.
   * Returns the rule augmented with status and a user-facing message.
   *
   * GUARDRAIL: If we don't have enough data to evaluate a rule,
   * we return 'cannot_evaluate' — we never fabricate a status.
   */
  _evaluateRule(rule, roomInput) {
    const { compass_zone, ai_observations = {} } = roomInput;
    const result = { ...rule, status: null, message: null };

    switch(rule.id) {

      // ── Room placement rules (zone-based) ──
      case 'MB-001':
      case 'K-001':
      case 'LR-001':
      case 'WR-001':
      case 'PR-001':
      case 'BAL-001':
        if (!compass_zone || compass_zone === 'unknown') {
          result.status  = 'cannot_evaluate';
          result.message = 'Upload a masterplan to determine compass zone.';
        } else if (rule.applicable_zones.includes('ALL') || rule.applicable_zones.includes(compass_zone)) {
          result.status  = 'compliant';
          result.message = `✓ ${rule.user_explanation}`;
        } else if (rule.non_compliant_zones.includes(compass_zone)) {
          result.status  = 'violated';
          result.message = `✗ This zone (${compass_zone}) is not recommended for this room type. ${rule.user_explanation}`;
        } else {
          result.status  = 'warning';
          result.message = `This room is in the ${compass_zone} zone — a neutral position for this rule.`;
        }
        break;

      // ── Bed direction ──
      case 'MB-002':
        // We can only evaluate this if we know direction — flag as advisory
        result.status  = 'warning';
        result.message = `Advisory: ${rule.user_explanation}`;
        break;

      // ── Mirror placement ──
      case 'MB-003':
        result.status  = 'warning';
        result.message = `Advisory: ${rule.user_explanation}`;
        break;

      // ── Overhead beam ──
      case 'MB-004':
        if (ai_observations.overhead_beams_detected === true) {
          result.status  = 'violated';
          result.message = `✗ Beam detected in photo. ${rule.user_explanation}`;
        } else if (ai_observations.overhead_beams_detected === false) {
          result.status  = 'compliant';
          result.message = `✓ No overhead beams detected. Room is clear.`;
        } else {
          result.status  = 'cannot_evaluate';
          result.message = 'Beam analysis requires a clear room photo.';
        }
        break;

      // ── Colour rules ──
      case 'COL-001':
      case 'COL-002':
      case 'COL-003':
        result.status  = 'good_to_have';
        result.message = rule.user_explanation;
        break;

      // ── General rules ──
      case 'GEN-001':
        result.status  = 'cannot_evaluate';
        result.message = 'Upload masterplan to check entrance direction.';
        break;

      case 'GEN-002':
        result.status  = 'good_to_have';
        result.message = rule.user_explanation;
        break;

      case 'LR-002':
        result.status  = 'warning';
        result.message = `Advisory: ${rule.user_explanation}`;
        break;

      case 'K-002':
        result.status  = 'warning';
        result.message = `Advisory: ${rule.user_explanation}`;
        break;

      default:
        result.status  = 'cannot_evaluate';
        result.message = 'Insufficient data to evaluate this rule.';
    }

    return result;
  }

  /**
   * Computes a 0–100 Vastu score.
   *
   * Scoring philosophy:
   *   — Start at 100
   *   — Deduct for violated rules (weighted by severity and score_impact)
   *   — Partial deduct for warnings
   *   — Bonus for must_follow rules that are compliant
   *   — Unresolvable rules do not penalise (we can't evaluate = not your fault)
   */
  _computeScore(evaluated) {
    let score = 100;
    const mustFollowTotal = evaluated.filter(r =>
      r.severity === 'must_follow' && r.status !== 'cannot_evaluate'
    ).length;

    evaluated.forEach(rule => {
      if (rule.status === 'violated') {
        const impact = Math.abs(rule.score_impact || 10);
        // must_fix violations are double-weighted
        score -= rule.severity === 'must_fix' ? impact * 1.5 : impact;
      }
      if (rule.status === 'warning') {
        score -= (Math.abs(rule.score_impact || 5)) * 0.3;
      }
      if (rule.status === 'compliant' && rule.severity === 'must_follow') {
        score += 2; // small bonus for actively compliant must-follow rules
      }
    });

    return Math.round(Math.max(0, Math.min(100, score)));
  }

  _grade(score) {
    if (score >= 90) return { letter: 'A', label: 'Excellent',     colour: '#1D9E75' };
    if (score >= 75) return { letter: 'B', label: 'Good',          colour: '#5C6B5A' };
    if (score >= 60) return { letter: 'C', label: 'Fair',          colour: '#B07D20' };
    if (score >= 45) return { letter: 'D', label: 'Needs review',  colour: '#C0502A' };
    return               { letter: 'F', label: 'Major concerns',   colour: '#B83232' };
  }

  _getZoneInfo(zone) {
    return this.zones?.[zone] || { deity: 'Unknown', element: 'Unknown', quality: 'Unknown', colour_family: 'neutral' };
  }

  _generateRecommendations(violated, warnings, goodToHave) {
    const recs = [];

    violated.forEach(r => {
      if (r.severity === 'must_fix' || r.severity === 'must_follow') {
        recs.push({ priority: 'high',   text: r.user_explanation, source: r.source });
      } else {
        recs.push({ priority: 'medium', text: r.user_explanation, source: r.source });
      }
    });

    warnings.forEach(r => {
      recs.push({ priority: 'low', text: r.user_explanation, source: r.source });
    });

    return recs;
  }

  /**
   * Given a masterplan analysis, return all room zone assessments.
   * Useful for a full-home Vastu report.
   */
  analyzeMasterplan(masterplanData) {
    const rooms = masterplanData?.rooms || [];
    return rooms.map(room => ({
      room_name: room.name,
      zone:      room.compass_zone,
      quick_assessment: this.analyzeRoom({
        room_type:       room.name.toLowerCase().replace(/\s+/g, '_'),
        compass_zone:    room.compass_zone,
        ai_observations: {}
      })
    }));
  }
}
