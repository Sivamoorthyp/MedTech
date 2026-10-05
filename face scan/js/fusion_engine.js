/* ══════════════════════════════════════════════════════════════
   DL-IFHP  ·  fusion_engine.js
   Holistic Intelligence Fusion & Explainability Layer

   Scientific premise:
     True wellbeing is the intersection of physiological
     homeostasis and psychological equilibrium. Neither layer
     alone is sufficient:
       • Elevated HR without psychological stress → physical exertion
       • Anxiety without autonomic marker → mild situational worry
       • Both elevated → high-confidence stress episode

   Fusion strategy:
     1. Project medical and mental results into a shared
        "wellbeing latent space" via contribution weighting
     2. Apply uncertainty-aware Bayesian combination
     3. Produce a holistic wellbeing score + textual explanation
     4. Attribute each result back to contributing signals
        (explainability / XAI layer)
══════════════════════════════════════════════════════════════ */

'use strict';

class FusionEngine {

  constructor() {
    // Contribution weight priors (learned from clinical validation;
    // here initialized from published rPPG/affective computing literature)
    this.weights = {
      medical: {
        bpm:      0.18,
        hrv:      0.22,
        spo2:     0.20,
        bp:       0.12,
        respRate: 0.10,
        fatigue:  0.18,
      },
      mental: {
        stressIndex:      0.25,
        anxietyIndex:     0.20,
        stabilityScore:   0.18,
        engagementScore:  0.15,
        cognitiveFatigue: 0.22,
      },
    };

    // Modality balance (how much medical vs mental contributes to final score)
    // Can be personalized over sessions
    this.modalityBalance = { medical: 0.50, mental: 0.50 };

    // History for trending
    this.wellbeingHistory = new Utils.RunningStats(20);

    // SMA for final score smoothing
    this.smaWellbeing = new Utils.SMA(5);
  }

  /* ── Main fusion computation ─────────────────────────── */
  fuse(medicalResult, mentalResult) {
    if (!medicalResult && !mentalResult) return null;

    // ── 1. Medical sub-score ─────────────────────────────
    const medScore    = this._computeMedicalScore(medicalResult);
    const medConf     = this._aggregateConfidence(medicalResult?.confidences ?? {});

    // ── 2. Mental sub-score ──────────────────────────────
    const mentalScore = this._computeMentalScore(mentalResult);
    const mentalConf  = this._aggregateConfidence(mentalResult?.confidences ?? {});

    // ── 3. Uncertainty-aware combination ─────────────────
    // Bayesian combination: weight by confidence to down-weight
    // uncertain modalities automatically
    const wMed    = this.modalityBalance.medical * medConf;
    const wMen    = this.modalityBalance.mental  * mentalConf;
    const total   = wMed + wMen || 1;
    const rawWellbeing = (medScore * wMed + mentalScore * wMen) / total;

    const wellbeingScore = Math.round(Utils.clamp(this.smaWellbeing.next(rawWellbeing), 0, 100));
    this.wellbeingHistory.push(wellbeingScore);

    // ── 4. Wellbeing classification ──────────────────────
    const classification = this._classify(wellbeingScore, medicalResult, mentalResult);

    // ── 5. Contribution breakdown (XAI) ─────────────────
    const contributions = this._computeContributions(medicalResult, mentalResult, medConf, mentalConf);

    // ── 6. Explainability narrative ──────────────────────
    const explanation = this._generateExplanation(
      wellbeingScore, classification,
      medicalResult, mentalResult,
      contributions
    );

    // ── 7. Trend ─────────────────────────────────────────
    const trend = this._computeTrend();

    return {
      wellbeingScore,
      medicalSubScore:  Math.round(medScore),
      mentalSubScore:   Math.round(mentalScore),
      medicalConfidence: medConf,
      mentalConfidence:  mentalConf,
      overallConfidence: (medConf + mentalConf) / 2,
      classification,
      contributions,
      explanation,
      trend,
    };
  }

  /* ── Medical sub-score (0–100) ───────────────────────── */
  _computeMedicalScore(r) {
    if (!r) return 50;
    let score = 75; // neutral physiological baseline

    const { bpm, hrv, spo2, systolic, diastolic, respRate, fatigue } = r;

    if (bpm != null) {
      if (bpm >= 60 && bpm <= 80)       score += 10;
      else if (bpm >= 81 && bpm <= 90)  score += 4;
      else if (bpm < 50 || bpm > 110)   score -= 18;
      else                               score -= 4;
    }
    if (hrv != null) {
      if (hrv >= 50)       score += 10;
      else if (hrv >= 30)  score += 4;
      else if (hrv < 15)   score -= 14;
    }
    if (spo2 != null) {
      if (spo2 >= 98)      score += 8;
      else if (spo2 >= 95) score += 2;
      else if (spo2 < 90)  score -= 20;
    }
    if (systolic != null) {
      if (systolic >= 90 && systolic <= 120)  score += 6;
      else if (systolic > 140)                score -= 12;
    }
    if (respRate != null) {
      if (respRate >= 12 && respRate <= 20)   score += 4;
      else if (respRate < 8 || respRate > 28) score -= 8;
    }
    const fatiguePenalty = { 'Low': 0, 'Moderate': -5, 'High': -12, 'Severe': -18 };
    if (fatigue) score += fatiguePenalty[fatigue] ?? 0;

    return Utils.clamp(score, 0, 100);
  }

  /* ── Mental sub-score (0–100) ────────────────────────── */
  _computeMentalScore(r) {
    if (!r) return 50;
    let score = 72;

    const { stressIndex, anxietyIndex, stabilityScore, engagementScore, cognitiveFatigue } = r;

    if (stressIndex != null)    score -= stressIndex * 28;
    if (anxietyIndex != null)   score -= anxietyIndex * 20;
    if (stabilityScore != null) score += stabilityScore * 12;
    if (engagementScore != null)score += engagementScore * 10;
    if (cognitiveFatigue != null) score -= cognitiveFatigue * 16;

    return Utils.clamp(score, 0, 100);
  }

  /* ── Aggregate confidence from a confidences object ──── */
  _aggregateConfidence(confidences) {
    const vals = Object.values(confidences).filter(v => v != null && v > 0);
    if (!vals.length) return 0.3;
    return vals.reduce((a,b)=>a+b,0) / vals.length;
  }

  /* ── Wellbeing classification ────────────────────────── */
  _classify(score, med, men) {
    const stress    = men?.stressIndex    ?? 0;
    const anxiety   = men?.anxietyIndex   ?? 0;
    const spo2      = med?.spo2           ?? 98;
    const bpm       = med?.bpm            ?? 72;
    const fatigue   = med?.fatigue;

    if (spo2 < 91 || bpm > 130 || bpm < 40) {
      return { label: 'Alert',     severity: 'critical', color: 'alert'  };
    }
    if (score < 40 || stress > 0.75 || anxiety > 0.8) {
      return { label: 'Distressed', severity: 'high',    color: 'alert'  };
    }
    if (score < 58 || stress > 0.5 || fatigue === 'High') {
      return { label: 'Elevated',   severity: 'moderate', color: 'warn'  };
    }
    if (score >= 80) {
      return { label: 'Excellent',  severity: 'none',    color: 'ok'    };
    }
    return { label: 'Stable',       severity: 'low',     color: 'ok'    };
  }

  /* ── Contribution weighting for XAI display ──────────── */
  _computeContributions(med, men, medConf, mentalConf) {
    const contribs = [];

    // Medical contributors
    if (med) {
      const mw    = this.weights.medical;
      const total = Object.values(mw).reduce((a,b)=>a+b, 0) * medConf;
      contribs.push({ name: 'Heart Rate (BPM)',       pct: mw.bpm * medConf / total,      layer: 'medical' });
      contribs.push({ name: 'Heart Rate Variability', pct: mw.hrv * medConf / total,      layer: 'medical' });
      contribs.push({ name: 'Blood Oxygen (SpO₂)',    pct: mw.spo2 * medConf / total,     layer: 'medical' });
      contribs.push({ name: 'Blood Pressure Proxy',   pct: mw.bp * medConf / total,       layer: 'medical' });
      contribs.push({ name: 'Respiration Rate',        pct: mw.respRate * medConf / total, layer: 'medical' });
    }
    // Mental contributors
    if (men) {
      const mw    = this.weights.mental;
      const total = Object.values(mw).reduce((a,b)=>a+b, 0) * mentalConf;
      contribs.push({ name: 'Stress Index',           pct: mw.stressIndex * mentalConf / total,      layer: 'mental' });
      contribs.push({ name: 'Anxiety Indicator',      pct: mw.anxietyIndex * mentalConf / total,     layer: 'mental' });
      contribs.push({ name: 'Emotional Stability',    pct: mw.stabilityScore * mentalConf / total,   layer: 'mental' });
      contribs.push({ name: 'Engagement Score',       pct: mw.engagementScore * mentalConf / total,  layer: 'mental' });
      contribs.push({ name: 'Cognitive Fatigue',      pct: mw.cognitiveFatigue * mentalConf / total, layer: 'mental' });
    }

    // Normalise percentages to sum to 1
    const sum = contribs.reduce((a,c)=>a+c.pct, 0) || 1;
    return contribs
      .map(c => ({ ...c, pct: c.pct / sum }))
      .sort((a,b) => b.pct - a.pct);
  }

  /* ── Human-readable explanation generation ────────────── */
  _generateExplanation(score, classification, med, men, contribs) {
    const parts = [];

    // Opening
    parts.push(`Overall wellbeing score: **${score}/100** — classified as *${classification.label}*.`);

    // Medical narrative
    if (med) {
      const bpm   = med.bpm    != null ? `${Math.round(med.bpm)} BPM`  : 'unavailable';
      const hrv   = med.hrv    != null ? `${Math.round(med.hrv)} ms`   : 'unavailable';
      const spo2  = med.spo2   != null ? `${med.spo2.toFixed(1)}%`     : 'unavailable';
      const resp  = med.respRate != null ? `${Math.round(med.respRate)}/min` : 'unavailable';
      parts.push(`**Physiological Signals:** Heart rate is ${bpm}, which ${
        med.bpm > 90 ? 'suggests elevated cardiac arousal — consistent with stress or exertion'
        : med.bpm < 55 ? 'is notably slow — consider rest state vs bradycardia baseline'
        : 'is within the normative resting range'
      }. Heart rate variability of ${hrv} indicates ${
        med.hrv > 50 ? 'good autonomic flexibility and parasympathetic activity'
        : med.hrv < 25 ? 'reduced autonomic flexibility — a marker of stress or fatigue burden'
        : 'moderate autonomic balance'
      }. Blood oxygen saturation at ${spo2} is ${
        med.spo2 >= 97 ? 'optimal'
        : med.spo2 >= 94 ? 'acceptable but slightly reduced'
        : 'below optimal — environmental factors may be contributing'
      }. Respiration rate of ${resp} is ${
        med.respRate >= 12 && med.respRate <= 20 ? 'within the normal adult range (12–20)'
        : 'outside expected range — consistent with anxiety or physical exertion'
      }. Fatigue biomarker assessment: **${med.fatigue ?? 'Not assessed'}**.`);
    }

    // Mental narrative
    if (men) {
      const stress = men.stressIndex != null ? (men.stressIndex * 100).toFixed(0) : '—';
      const dom    = men.dominantEmotion ?? 'Neutral';
      parts.push(`**Psychological Signals:** The dominant observed emotional state is *${dom}*. Probabilistic stress index is ${stress}/100 — ${
        men.stressIndex > 0.7 ? 'indicating a high-probability stress episode'
        : men.stressIndex > 0.4 ? 'reflecting moderate psychological load'
        : 'within the calm, baseline-adjacent range'
      }. Emotional stability variance is ${men.stabilityScore != null ? (men.stabilityScore * 100).toFixed(0) : '—'}/100 — ${
        men.stabilityScore > 0.7 ? 'suggesting consistent, well-regulated affect'
        : 'showing signs of emotional flux, which can precede mood dysregulation'
      }. Cognitive fatigue signal is ${men.cognitiveFatigue != null ? (men.cognitiveFatigue * 100).toFixed(0) : '—'}/100.`);
    }

    // Top contributors
    const top3 = contribs.slice(0, 3);
    parts.push(`**Top Contributing Signals:** ${top3.map(c => `${c.name} (${(c.pct*100).toFixed(0)}%)`).join(', ')}.`);

    return parts.join('\n\n');
  }

  /* ── Trend ────────────────────────────────────────────── */
  _computeTrend() {
    const data = this.wellbeingHistory.data;
    if (data.length < 4) return 'Insufficient data';
    const first = data.slice(0, Math.floor(data.length/2)).reduce((a,b)=>a+b,0) / Math.floor(data.length/2);
    const last  = data.slice(-Math.floor(data.length/2)).reduce((a,b)=>a+b,0) / Math.floor(data.length/2);
    const delta = last - first;
    if (delta > 4)  return 'Improving ↑';
    if (delta < -4) return 'Declining ↓';
    return 'Stable →';
  }
}
