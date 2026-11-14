// Pure scoring helpers. Used by content.js, popup.js and the node test.
(function (root) {
  const RI = {};

  RI.fmt = (n) => {
    if (n == null || !isFinite(n)) return '—';
    const a = Math.abs(n);
    const t = (x, s) => (x >= 100 ? Math.round(x) : x.toFixed(1).replace(/\.0$/, '')) + s;
    if (a >= 1e9) return t(n / 1e9, 'B');
    if (a >= 1e6) return t(n / 1e6, 'M');
    if (a >= 1e3) return t(n / 1e3, 'K');
    return String(Math.round(n));
  };
  RI.pct = (x) => (x == null || !isFinite(x) ? '—' : (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%');
  RI.times = (x) => (x == null || !isFinite(x) ? '—' : (x >= 10 ? Math.round(x) : x.toFixed(1)) + 'x');

  RI.median = (arr) => {
    const a = arr.filter((x) => x != null && isFinite(x)).sort((p, q) => p - q);
    if (!a.length) return null;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };

  const tier = (x, steps, low) => { for (const [min, pts] of steps) if (x >= min) return pts; return low; };

  /**
   * m: media stats {views, likes, comments, takenAt, likesHidden}
   * base: {followers, median, sampleSize}
   * Returns score 0-100, verdict, metrics, reasons (Tenglish).
   */
  RI.scoreReel = (m, base = {}, nowMs = Date.now()) => {
    const r = { score: 0, verdict: 'nodata', label: 'Data ledu', metrics: {}, reasons: [], warnings: [] };
    const views = m?.views;
    if (!views) {
      r.warnings.push('Views count dorakaledu. Reel play chesi konchem wait cheyandi.');
      return r;
    }
    const followers = base.followers ?? m.followers ?? null;
    const median = base.sampleSize >= 4 ? base.median : null;
    const met = r.metrics;
    met.outlierMedian = median ? views / median : null;
    met.outlierFollowers = followers ? views / followers : null;

    // 1. Outlier: up to 50 points
    let pts;
    if (met.outlierMedian != null) {
      const x = met.outlierMedian;
      pts = tier(x, [[5, 50], [3, 40], [2, 28], [1, 15]], 5);
      r.reasons.push(x >= 1
        ? `Creator normal reels kanna ${RI.times(x)} views (avg ${RI.fmt(median)})`
        : `Creator normal reels kanna takkuva views (${RI.times(x)}, avg ${RI.fmt(median)})`);
    } else if (met.outlierFollowers != null) {
      const x = met.outlierFollowers;
      pts = tier(x, [[3, 45], [1.5, 35], [1, 22], [0.5, 12]], 5);
      (x >= 1 ? r.reasons : r.warnings).push(`Views = followers ki ${RI.times(x)} (${RI.fmt(followers)} followers)`);
      r.warnings.push('Creator recent reels dorakaledu, followers tho compare chesam.');
    } else {
      pts = 20;
      r.warnings.push('Creator baseline dorakaledu, outlier score approximate.');
    }
    const outlierPts = pts;
    r.score += pts;

    // 2. Engagement rate: up to 25 points
    const likes = m.likes;
    let comments = m.comments ?? 0;
    // "Comment X for the link" reels: comments are automation triggers, not real interest
    met.commentBait = likes != null && comments > likes;
    if (met.commentBait) {
      r.warnings.push('Comments likes kanna ekkuva: "comment chesi link teesko" type reel laaga undi, engagement inflate ayyi untundi.');
      comments = Math.min(comments, likes);
    }
    if (likes != null && !m.likesHidden) {
      met.er = (likes + comments) / views;
      r.score += tier(met.er, [[0.08, 25], [0.05, 20], [0.03, 14], [0.015, 8]], 3);
      r.reasons.push(`Engagement ${RI.pct(met.er)} ${met.er >= 0.05 ? '(strong)' : met.er >= 0.03 ? '(okay)' : '(weak)'}`);
    } else {
      r.score += 10;
      r.warnings.push('Likes hidden, engagement check cheyaleka poyam.');
    }

    // 3. Conversation: up to 10 points
    if (likes && comments != null) {
      met.commentRatio = comments / likes;
      r.score += tier(met.commentRatio, [[0.03, 10], [0.015, 6]], 2);
      if (met.commentRatio >= 0.03 && !met.commentBait) r.reasons.push('Comments ekkuva: topic meeda debate/interest undi');
    }

    // 4. Freshness: up to 15 points
    if (m.takenAt) {
      const days = Math.max((nowMs / 1000 - m.takenAt) / 86400, 1 / 24);
      met.ageDays = days;
      met.perDay = views / days;
      r.score += tier(-days, [[-14, 15], [-60, 11], [-180, 7]], 3);
      if (days > 180) r.warnings.push('6 months kanna patha reel: trend ayipoyindemo check cheyandi.');
      else if (days <= 14) r.reasons.push(`Fresh reel (${days < 1 ? 'today' : Math.round(days) + ' days'}), ${RI.fmt(met.perDay)} views/day`);
    } else {
      r.score += 7;
    }

    r.score = Math.round(Math.min(100, r.score));

    if (r.score >= 65) { r.verdict = 'recreate'; r.label = 'Recreate'; }
    else if (r.score >= 45) { r.verdict = 'maybe'; r.label = 'Maybe'; }
    else { r.verdict = 'skip'; r.label = 'Skip'; }

    // Guards: small sample, or high score without a real outlier
    if (views < 10000 && r.verdict === 'recreate') {
      r.verdict = 'maybe'; r.label = 'Maybe';
      r.warnings.push('Views inka 10K kuda levu, sample chinnadi.');
    }
    if (met.outlierMedian == null && met.outlierFollowers == null && r.verdict === 'recreate') {
      r.verdict = 'maybe'; r.label = 'Maybe';
      r.warnings.push('Outlier teliyakunda Recreate ani cheppalem, baseline load cheyandi.');
    }
    // Recreate needs a real outlier: 2x creator avg, or 1.5x followers
    const strong = met.outlierMedian != null ? met.outlierMedian >= 2 : met.outlierFollowers != null && met.outlierFollowers >= 1.5;
    if (!strong && r.verdict === 'recreate' && (met.outlierMedian != null || met.outlierFollowers != null)) {
      r.verdict = 'maybe'; r.label = 'Maybe';
      r.warnings.push('Engagement bagundi kani creator normal kanna ekkuva reach raaledu.');
    }
    if (met.ageDays != null && met.ageDays < 2) r.warnings.push('Reel 2 days kanna kotta, numbers inka perugutayi. Repu malli chudandi.');
    return r;
  };

  root.ReelInsight = RI;
  if (typeof module !== 'undefined') module.exports = RI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
